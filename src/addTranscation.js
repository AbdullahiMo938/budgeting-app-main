import React, { useState, useEffect, useCallback, useMemo } from "react";
import { db, auth } from "./firebase-config";
import { collection, addDoc, doc, getDoc, updateDoc, setDoc, Timestamp, runTransaction } from "firebase/firestore";
import { calculateOptimizedBudget, getSpendingAlerts } from "./utils/budgetOptimizer";
import { useNavigate } from "react-router-dom";
import "./App.css";

const AddTransaction = () => {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const categories = [
    "Housing", "Transportation", "Food", "Utilities", 
    "Entertainment", "Savings", "Personal", "Other"
  ];
  const [alerts, setAlerts] = useState([]);
  const [optimization, setOptimization] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  // Default budget values
  const DEFAULT_MONTHLY_BUDGET = useMemo(() => 2000, []); // Default monthly budget in £
  const DEFAULT_CATEGORIES = useMemo(() => ({
    Housing: 0.3, // 30%
    Transportation: 0.15, // 15%
    Food: 0.15, // 15%
    Utilities: 0.1, // 10%
    Entertainment: 0.1, // 10%
    Savings: 0.1, // 10%
    Personal: 0.05, // 5%
    Other: 0.05 // 5%
  }), []);

  // Initialize user's budget if it doesn't exist
  const initializeUserBudget = useCallback(async (userId) => {
    try {
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists() || !userDoc.data().budget) {
        console.log("Creating default budget for user:", userId);
        // Create default budget structure
        const defaultBudgetData = {
          budget: DEFAULT_MONTHLY_BUDGET,
          categories: Object.entries(DEFAULT_CATEGORIES).map(([category, percentage]) => ({
            name: category,
            allocation: DEFAULT_MONTHLY_BUDGET * percentage,
            percentage: percentage * 100
          })),
          lastUpdated: Timestamp.now(),
          createdAt: Timestamp.now(),
          userId: userId // Add userId field to ensure security rules work
        };

        try {
          await setDoc(userRef, defaultBudgetData, { merge: true });
          console.log("Default budget created successfully");
          return defaultBudgetData;
        } catch (error) {
          console.error("Error creating default budget:", error);
          throw error;
        }
      }

      return userDoc.data();
    } catch (error) {
      console.error('Error initializing budget:', error);
      throw error;
    }
  }, [DEFAULT_MONTHLY_BUDGET, DEFAULT_CATEGORIES]);

  // Check for authentication and set up user data
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        navigate('/login');
        return;
      }

      setUser(currentUser);
      setError(null);

      try {
        // Initialize or get user's budget
        await initializeUserBudget(currentUser.uid);
        
        // Check for optimization opportunities
        const checkOptimization = async () => {
          try {
            const userRef = doc(db, "users", currentUser.uid);
            const userDoc = await getDoc(userRef);
            
            if (userDoc.exists()) {
              const userData = userDoc.data();
              const optimizationData = await calculateOptimizedBudget(currentUser.uid, userData.budget);
              setOptimization(optimizationData);
              
              if (optimizationData.needsOptimization) {
                const newAlerts = getSpendingAlerts(optimizationData);
                setAlerts(newAlerts);
              }
            }
          } catch (error) {
            console.error("Error checking optimization:", error);
          }
        };

        await checkOptimization();
      } catch (error) {
        console.error("Error setting up user data:", error);
        setError("Error loading user data. Please try again later.");
      }
    });

    return () => unsubscribe();
  }, [navigate, initializeUserBudget]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log("Form submitted with values:", { amount, category });
    
    if (!user) {
      setError("You must be logged in to add transactions");
      navigate('/login');
      return;
    }

    if (!amount || !category) {
      setError("Please enter both amount and category");
      return;
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setError("Please enter a valid positive amount");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      
      console.log("Starting transaction submission process...");
      const userId = user.uid;
      const userRef = doc(db, "users", userId);
      
      // Get current user data or initialize if it doesn't exist
      let userData;
      try {
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
          userData = await initializeUserBudget(userId);
        } else {
          userData = userDoc.data();
        }
      } catch (error) {
        console.error("Error getting user data:", error);
        setError("Error accessing your budget data. Please try again.");
        setSubmitting(false);
        return;
      }

      const parsedAmount = parseFloat(amount);
      const newBudget = userData.budget - parsedAmount;

      // Use a transaction to ensure atomic updates
      await runTransaction(db, async (transaction) => {
        // Create a new transaction document
        const transactionsRef = collection(db, "transactions");
        const newTransactionRef = doc(transactionsRef);
        
        // Get spending stats
        const statsRef = doc(db, "spendingStats", userId);
        const statsDoc = await transaction.get(statsRef);
        const currentStats = statsDoc.exists() ? statsDoc.data() : { totalSpending: 0 };
        
        // Set the transaction document
        transaction.set(newTransactionRef, {
          userId,
          amount: parsedAmount,
          category,
          timestamp: Timestamp.now(),
          description: `${category} expense`,
          createdAt: Timestamp.now()
        });

        // Update user's budget
        transaction.update(userRef, {
          budget: newBudget,
          lastUpdated: Timestamp.now()
        });

        // Update spending stats
        const newTotalSpending = (currentStats.totalSpending || 0) + parsedAmount;
        if (statsDoc.exists()) {
          transaction.update(statsRef, {
            totalSpending: newTotalSpending,
            lastUpdated: Timestamp.now()
          });
        } else {
          transaction.set(statsRef, {
            userId,
            totalSpending: newTotalSpending,
            lastUpdated: Timestamp.now()
          });
        }
      });

      console.log("Transaction completed successfully");
      
      // Clear form and show success message
      setAmount("");
      setCategory("");
      setSubmitting(false);
      alert(`Transaction added successfully! New budget: £${newBudget.toFixed(2)}`);
      
      // Navigate to dashboard after alert is dismissed
      navigate('/dashboard');
      
    } catch (error) {
      console.error("Error adding transaction:", error);
      setError("Failed to add transaction. Please try again.");
      setSubmitting(false);
    }
  };

  const handleOptimizeBudget = async () => {
    if (!optimization?.needsOptimization) return;

    try {
      setLoading(true);
      setError(null);
      
      const user = auth.currentUser;
      if (!user) {
        setError("You must be logged in to optimize your budget");
        navigate('/login');
        return;
      }
      
      const userRef = doc(db, "users", user.uid);
      
      await updateDoc(userRef, {
        budget: optimization.suggestedBudget
      });

      alert(`Budget optimized! New budget: £${optimization.suggestedBudget.toFixed(2)}`);
      
      // Reset optimization state
      setOptimization({
        ...optimization,
        needsOptimization: false
      });
      
      setAlerts([]);
    } catch (error) {
      console.error("Error optimizing budget:", error);
      if (error.code === 'permission-denied' || error.message.includes('permission')) {
        setError("You don't have permission to update your budget. Please check your account settings.");
      } else {
        setError("Error optimizing budget. Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Only show loading overlay when submitting
  if (submitting) {
    return (
      <div className="add-transaction-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Processing transaction...</p>
          <button onClick={() => {
            setSubmitting(false);
            setError("Transaction cancelled by user");
          }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="add-transaction-container">
      <h2>Add Transaction</h2>
      
      {error && (
        <div className="error-container">
          <p>{error}</p>
          <div className="error-actions">
            <button onClick={() => setError(null)}>Dismiss</button>
            {error.includes("logged in") && (
              <button onClick={() => navigate('/login')}>Go to Login</button>
            )}
            {error.includes("permission") && (
              <button onClick={() => auth.signOut().then(() => navigate('/login'))}>
                Log Out & Log In Again
              </button>
            )}
            <button onClick={() => setShowDebug(!showDebug)}>
              {showDebug ? "Hide Debug Info" : "Show Debug Info"}
            </button>
          </div>
          
          {showDebug && debugInfo && (
            <div className="debug-info">
              <h4>Debug Information</h4>
              <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="amount">Amount (£)</label>
          <input
            type="number"
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
            required
            min="0.01"
            step="0.01"
          />
        </div>

        <div className="form-group">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            <option value="">Select a category</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={submitting}>
          Add Transaction
        </button>
      </form>

      {alerts.length > 0 && (
        <div className="alerts-container">
          <h3>Budget Alerts</h3>
          {alerts.map((alert, index) => (
            <div key={index} className={`alert alert-${alert.type}`}>
              {alert.message}
            </div>
          ))}
          {optimization?.needsOptimization && (
            <button
              className="optimize-button"
              onClick={handleOptimizeBudget}
              disabled={loading}
            >
              Optimize Budget
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AddTransaction;
