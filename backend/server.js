const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

// API to update transactions and adjust budget dynamically
app.post("/api/add-transaction", async (req, res) => {
  const { userId, amount, category } = req.body;

  try {
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send({ message: "User not found" });
    }

    let userData = userDoc.data();
    let newBudget = userData.budget - amount; // Reduce budget dynamically

    // Store the transaction
    await userRef.collection("transactions").add({
      amount,
      category,
      timestamp: new Date(),
    });

    // Update the budget dynamically
    await userRef.update({ budget: newBudget });

    res.status(200).send({ message: "Transaction added", newBudget });
  } catch (error) {
    console.error("Error adding transaction:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
