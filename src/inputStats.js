import React, { useState } from "react";
import { db, auth } from "./firebase-config"; // Ensure auth is imported for user ID
import { collection, addDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./App.css";

const categories = {
  Housing: ["Mortgage or rent", "Property taxes"],
  Transportation: ["Car payment", "Car Insurance", "Petrol"],
  Food: ["Groceries", "Restaurants", "Pet food"],
  Utilities: ["Electricity", "Water", "Gas", "Phones", "Internet"],
  Clothing: ["Clothing"],
  Personal: ["Gym memberships", "Haircuts"],
  Retirement: ["Financial planning", "Investing"],
  Savings: ["Emergency fund", "Big purchases", "Other savings"],
  Entertainment: ["Games", "Movies", "Vacations", "Subscriptions"]
};

const InputStats = () => {
  const [spendingStats, setSpendingStats] = useState({});
  const [errorMessage, setErrorMessage] = useState("");
  const navigate = useNavigate();

  const handleChange = (category, subcategory, value) => {
    setSpendingStats((prevStats) => ({
      ...prevStats,
      [category]: {
        ...prevStats[category],
        [subcategory]: parseFloat(value) || 0,
      },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    try {
      // Get the current user's ID from Firebase Auth
      const userId = auth.currentUser?.uid;

      if (!userId) {
        setErrorMessage("You must be logged in to save your stats.");
        return;
      }

      // Save the spending stats to Firestore with the user's ID
      await addDoc(collection(db, "spendingStats"), {
        userId,
        spendingStats,
        timestamp: new Date(), // Add a timestamp for sorting later
      });

      console.log("Spending Stats Saved:", spendingStats);

      // Reset form
      setSpendingStats({});

      // Redirect to MyStats page
      navigate("/mystats");
    } catch (error) {
      console.error("Error saving spending stats:", error);
      setErrorMessage("Failed to save spending stats. Please try again.");
    }
  };

  return (
    <div className="input-stats-container">
      <h1>Input your Spending Stats Here!</h1>
      <form onSubmit={handleSubmit}>
        {Object.keys(categories).map((category) => (
          <div key={category} className="category">
            <h2>{category}</h2>
            {categories[category].map((subcategory) => (
              <div key={subcategory} className="subcategory">
                <label htmlFor={`${category}-${subcategory}`}>{subcategory} (£):</label>
                <input
                  type="number"
                  id={`${category}-${subcategory}`}
                  placeholder="Enter amount in £"
                  value={
                    spendingStats[category]?.[subcategory] || "" // Reset inputs when the form is submitted
                  }
                  onChange={(e) =>
                    handleChange(category, subcategory, e.target.value)
                  }
                />
              </div>
            ))}
          </div>
        ))}
        
        <button type="submit" className="submit-button">Save Stats</button>
      </form>

      {errorMessage && <p className="error-message">{errorMessage}</p>}

      {/* Button to navigate to MyStats */}
      <button onClick={() => navigate("/mystats")} className="mystats-button">
        View My Stats
      </button>
    </div>
  );
};

export default InputStats;
