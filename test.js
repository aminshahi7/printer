

require("dotenv").config();

const { printReceipt } = require("./printer");

const testOrder = {
  _id: "TEST-1001",
  firstname: "Amin",
  lastname: "Test",
  telephone: "0123456789",

  appetizer: [
    {
      name: "Sambusa",
      quantity: 2,
      price: 5.50
    }
  ],

  mainDish: [
    {
      name: "Gemischt",
      quantity: 1,
      price: 18.80
    }
  ],

  dessertCart: [],
  freeDrink: [],
  wine: [],
  beer: [],

  note: "Ohne Zwiebeln",
  totalprice: 29.80
};

async function main() {
  try {
    await printReceipt(testOrder);
    console.log("Druckdaten erfolgreich gesendet");
  } catch (error) {
    console.error("Druckfehler:", error.message);
  }
}

main();