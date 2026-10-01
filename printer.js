
const net = require("node:net");

// Preise mit zwei Nachkommastellen anzeigen.
function formatPrice(price) {
  return `${Number(price || 0)
    .toFixed(2)
    .replace(".", ",")} EUR`;
}

function formatPickupDate(order) {
  const date = order.pickupDate || order.createdAt;

  if (!date) {
    return "-";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "-";
  }

  return parsedDate.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

// Jede Kategorie kann ihren Namen unabhängig formatieren.
const CATEGORY_FORMATTERS = {
  VORSPEISEN: item => item.name,
  HAUPTSPEISEN: item =>
    `${item.name} --- (BOLD_START${item.bread}BOLD_END)---`,
  DESSERTS: item => `${item.name}(${item.topping})`,
  GETRAENKE: item => item.name,
  WEIN: item => item.name,
  BIER: item => item.name
};

function formatItemName(title, item) {
  const formatter = CATEGORY_FORMATTERS[title];
  return formatter ? formatter(item) : item.name;
}

function formatExtras(extras, extraQuantities = []) {
  const groupedExtras = new Map();

  for (const [index, extra] of extras.entries()) {
    const configuredQuantity =
      extra.quantity ??
      extra.amount ??
      extra.number ??
      extraQuantities[index];
    const quantity = Number(configuredQuantity ?? 1);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    const key = `${extra.name}|${extra.price ?? ""}`;
    const current = groupedExtras.get(key);

    if (current) {
      current.quantity += quantity;
    } else {
      groupedExtras.set(key, {
        name: extra.name,
        price: extra.price,
        quantity
      });
    }
  }

  return [...groupedExtras.values()]
    .map(extra => {
      const extraText = `${extra.quantity}x ${extra.name}`;

      return extra.price !== undefined
        ? `${extraText} ${formatPrice(extra.price * extra.quantity)}`
        : extraText;
    })
    .join("\n");
}

// Produkte einer Kategorie auf den Bon schreiben.
function addItemsToReceipt(lines, title, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  lines.push("");
  lines.push(title);

  for (const item of items) {
    const quantity = Number(
      item.quantity ?? item.amount ?? 1
    );

    const name = formatItemName(title, item);

    const options = Array.isArray(item.options)
      ? item.options.join(", ")
      : "";

    const extras = Array.isArray(item.extras)
      ? formatExtras(
        item.extras,
        item.extrasOption ?? item.extraQuantities
      )
      : "";

    lines.push(
      `${quantity}x ${name}` +
      "\n" +
      (options ? ` (${options})` : "") +
       "\n" 
    );

    if (item.price !== undefined) {
      lines.push(
        `   ${formatPrice(item.price * quantity)}`
      );
    }

    lines.push(
      (extras ? `BOLD_START${extras}BOLD_END` : "") +
      "\n"
    );

    lines.push("------------------------------");
  }
}

// Vollständigen Bon erstellen.
function createReceipt(order) {
  console.log(order.mainDish);
  const lines = [
    "IM HERZEN AFRIKAS",
    "ABHOLBESTELLUNG",
    "------------------------------",
    `Bestellung: ${order._id}`,
    `Name: ${order.firstname || ""} ${order.lastname || ""}`,
    `Telefon: ${order.telephone || "-"}`,
    `Datum: ${formatPickupDate(order)}`,
    `Abholzeit: ${order.pickupTime || "-"}`,
    "Art: Abholung vor Ort",
    "------------------------------"
  ];

  addItemsToReceipt(
    lines,
    "VORSPEISEN",
    order.appetizer
  );

  addItemsToReceipt(
    lines,
    "HAUPTSPEISEN",
    order.mainDish
  );

  addItemsToReceipt(
    lines,
    "DESSERTS",
    order.dessertCart
  );

  addItemsToReceipt(
    lines,
    "GETRAENKE",
    order.freeDrink
  );

  addItemsToReceipt(
    lines,
    "WEIN",
    order.wine
  );

  addItemsToReceipt(
    lines,
    "BIER",
    order.beer
  );

  if (order.note) {
    lines.push("");
    lines.push(`NOTIZ: ${order.note}`);
  }

  lines.push("");
  lines.push("------------------------------");
  lines.push(
    `ZWISCHENSUMME: ${formatPrice(order.totalprice)}`
  );
  lines.push("Lieferung: Abholung vor Ort");
  lines.push(
    `GESAMTPREIS: ${formatPrice(order.totalprice)}`
  );
  lines.push("");
  lines.push("Vielen Dank!");
  lines.push("");
  lines.push("");
  lines.push("");

  return lines.join("\n");
}

// Den Bon über TCP an den Drucker senden.
function printReceipt(order) {
  return new Promise((resolve, reject) => {
    const host = process.env.PRINTER_HOST;
    const port = Number(
      process.env.PRINTER_PORT || 9100
    );
    const timeout = Number(
      process.env.PRINTER_TIMEOUT || 10000
    );

    const socket = new net.Socket();

    let settled = false;
    let transmissionFinished = false;

    function finish(error) {
      if (settled) return;

      settled = true;
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.setTimeout(timeout);

    socket.on("timeout", () => {
      finish(new Error("Drucker-Timeout"));
    });

    socket.on("error", error => {
      finish(error);
    });

    socket.on("close", hadError => {
      if (settled) return;

      if (hadError || !transmissionFinished) {
        finish(new Error(
          "Druckerverbindung vorzeitig geschlossen"
        ));
      } else {
        finish();
      }
    });

    socket.connect(port, host, () => {
      // ESC/POS: Drucker initialisieren.
      const initialize = Buffer.from([
        0x1b, 0x40
      ]);

      const BOLD_ON = "\x1b\x45\x01";
      const BOLD_OFF = "\x1b\x45\x00";

      const receiptText = createReceipt(order)
        .replaceAll("BOLD_START", BOLD_ON)
        .replaceAll("BOLD_END", BOLD_OFF);  

      // Bontext in Bytes umwandeln.
      const receipt = Buffer.from(
        receiptText,
        "ascii"
      );

      // ESC/POS: Papier schneiden.
      const cut = Buffer.from([
        0x1d, 0x56, 0x00
      ]);

      const data = Buffer.concat([
        initialize,
        receipt,
        cut
      ]);

      // Daten senden und Verbindung schließen.
      socket.end(data, () => {
        transmissionFinished = true;
      });
    });
  });
}

module.exports = {
  createReceipt,
  printReceipt
};