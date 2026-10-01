
require("dotenv").config();

const { printReceipt } = require("./printer");

const API = process.env.BACKEND_URL?.replace(/\/$/, "");
const API_KEY = process.env.PRINT_WORKER_API_KEY;

if (
  !API ||
  !API_KEY ||
  !process.env.PRINTER_HOST
) {
  throw new Error(
    "Bitte die .env-Datei überprüfen"
  );
}

const headers = {
  "Content-Type": "application/json",
  "x-print-api-key": API_KEY
};

// Eine bestimmte Zeit warten.
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Nächste wartende Bestellung reservieren.
async function claimOrder() {
  const response = await fetch(
    `${API}/api/print/claim`,
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15000)
    }
  );

  // Keine Bestellung vorhanden.
  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Bestellung abholen: HTTP ${response.status}`
    );
  }

  return response.json();
}

// Druckergebnis an Express melden.
async function reportResult(
  orderId,
  claimId,
  result,
  error
) {
  const response = await fetch(
    `${API}/api/print/${orderId}/${result}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        claimId,
        error
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Statusmeldung fehlgeschlagen: HTTP ${response.status}`
    );
  }

  return response.json();
}

// Genau eine Bestellung verarbeiten.
async function processOrder() {
  const claimed = await claimOrder();

  if (!claimed) {
    return false;
  }

  const { order, claimId } = claimed;

  console.log(
    "Neue Bestellung:",
    order._id
  );

  try {
    await printReceipt(order);

  } catch (error) {
    console.error(
      "Druckfehler:",
      error.message
    );

    await reportResult(
      order._id,
      claimId,
      "failure",
      error.message
    );

    return true;
  }

  // Übertragung ohne erkannten Fehler.
  await reportResult(
    order._id,
    claimId,
    "success"
  );

  console.log(
    "Druckauftrag gesendet:",
    order._id
  );

  return true;
}

// Worker dauerhaft ausführen.
async function startWorker() {
  console.log("Print Worker gestartet");

  while (true) {
    try {
      // Alle wartenden Bestellungen nacheinander.
      while (await processOrder()) {
        // Nächste Bestellung.
      }

    } catch (error) {
      console.error(
        "Worker-Fehler:",
        error.message
      );
    }

    // Fünf Sekunden warten.
    await sleep(5000);
  }
}

startWorker();