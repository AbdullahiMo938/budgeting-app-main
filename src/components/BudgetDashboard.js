import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { db, auth } from "../firebase-config";
import { collection, query, where, getDocs, doc, getDoc, setDoc, Timestamp, updateDoc, arrayUnion } from 'firebase/firestore';
import { calculateOptimizedBudget, getSpendingAlerts } from "../utils/budgetOptimizer";
import { useNavigate } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';

const BudgetDashboard = () => {
  console.log("BudgetDashboard component rendering"); // Debug log
  const navigate = useNavigate();
  const [optimization, setOptimization] = useState(null);
  const [spendingTrends, setSpendingTrends] = useState([]);
  const [categoryDistribution, setCategoryDistribution] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [monthlyComparison, setMonthlyComparison] = useState([]);
  const [debugInfo, setDebugInfo] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  // These state variables are used in the authentication flow and error handling
  // They're set in various functions but may appear unused to ESLint
  // eslint-disable-next-line no-unused-vars
  const [permissionChecked, setPermissionChecked] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [refreshingToken, setRefreshingToken] = useState(false);
  const [dataFetched, setDataFetched] = useState(false);
  const [efficiencyMetrics, setEfficiencyMetrics] = useState({});
  const [selectedMetricCategory, setSelectedMetricCategory] = useState('All');
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [newBudget, setNewBudget] = useState('');
  const [newCategoryBudgets, setNewCategoryBudgets] = useState({});
  // Milestone tracker state variables
  const [userGoals, setUserGoals] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [newSavingAmount, setNewSavingAmount] = useState('');
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [reachedMilestone, setReachedMilestone] = useState(null);
  const confettiRef = useRef(null);

  // Use useMemo for arrays to prevent unnecessary re-renders
  const COLORS = useMemo(() => 
    ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#0ef', '#ba55d3']
  , []);

  // Use useMemo to prevent primitive values from being recreated
  const DEFAULT_MONTHLY_BUDGET = useMemo(() => 2000, []); // Default monthly budget in £
  
  // Use useMemo to prevent the object from being recreated on every render
  // This fixes the ESLint warning about dependencies changing on every render
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

  // Function to check if the user has the necessary permissions
  const checkUserPermissions = useCallback(async (user) => {
    if (!user) return false;
    
    try {
      // Try to read a small piece of data to check permissions
      const userRef = doc(db, "users", user.uid);
      await getDoc(userRef);
      return true;
    } catch (error) {
      console.error("Permission check failed:", error);
      if (error.code === 'permission-denied' || error.message.includes('permission')) {
        return false;
      }
      // For other errors, we'll assume permissions are okay
      return true;
    }
  }, []);

  // Function to refresh the user's authentication token with rate limiting
  const refreshAuthToken = useCallback(async () => {
    const REFRESH_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds
    const lastRefresh = localStorage.getItem('lastTokenRefresh');
    const now = Date.now();

    if (lastRefresh && (now - parseInt(lastRefresh)) < REFRESH_COOLDOWN) {
      console.log("Token refresh skipped - too soon since last refresh");
      return false;
    }

    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        // Force token refresh
        await currentUser.getIdToken(true);
        localStorage.setItem('lastTokenRefresh', now.toString());
        console.log("Authentication token refreshed successfully for user:", currentUser.uid);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error refreshing authentication token:", error);
      if (error.code === 'auth/quota-exceeded') {
        // Wait before allowing another refresh
        localStorage.setItem('lastTokenRefresh', now.toString());
        setError("Too many authentication attempts. Please wait a few minutes and try again.");
      }
      return false;
    }
  }, []);

  // Function to handle permission errors with retry logic
  const handlePermissionError = useCallback(async () => {
    setLoading(true);
    setRefreshingToken(true);
    setError(null);
    
    try {
      // First, try to refresh the token
      const tokenRefreshed = await refreshAuthToken();
      
      if (tokenRefreshed) {
        // If token was refreshed, check permissions again
        const currentUser = auth.currentUser;
        if (currentUser) {
          const hasPermissions = await checkUserPermissions(currentUser);
          
          if (hasPermissions) {
            // If permissions are now valid, fetch data
            // We'll call fetchDashboardData directly in the useEffect instead
            // to avoid the circular dependency
            setRefreshingToken(false);
            return true;
          }
        }
      }
      
      // If we get here, token refresh didn't help
      setError("Missing or insufficient permissions. Please check your account settings and make sure you're properly logged in.");
      setDebugInfo({
        errorMessage: "Firebase permission denied after token refresh attempt",
        errorCode: "permission-denied",
        timestamp: new Date().toISOString(),
        suggestion: "This is likely due to Firebase security rules. Try logging out and logging back in, or contact the administrator."
      });
      setLoading(false);
      setRefreshingToken(false);
      return false;
    } catch (error) {
      console.error("Error handling permission error:", error);
      setError("Failed to resolve permission issue. Please try logging out and logging back in.");
      setDebugInfo({
        errorMessage: error.message,
        errorCode: error.code,
        errorStack: error.stack,
        timestamp: new Date().toISOString()
      });
      setLoading(false);
      setRefreshingToken(false);
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAuthToken, checkUserPermissions]);

  const initializeUserBudget = useCallback(async (user) => {
    try {
      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists() || !userDoc.data().budget) {
        console.log("Creating default budget for user:", user.uid);
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
          userId: user.uid // Add userId field to ensure security rules work
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

  // Memoize the fetchDashboardData function to prevent unnecessary re-renders
  const fetchDashboardData = useCallback(async (user) => {
    try {
      setLoading(true);
      setError(null);
      setDebugInfo(null);

      // Initialize or get user's budget data
      let userData;
      try {
        userData = await initializeUserBudget(user);
        console.log("User budget data:", userData); // Debug log
      } catch (error) {
        console.error('Error initializing budget:', error);
        if (error.message.includes('permission') || error.code === 'permission-denied') {
          setError("Missing or insufficient permissions to access budget data.");
          setLoading(false);
          return;
        }
        throw error;
      }

      // Get user's financial goals if they exist
      try {
        const userGoalsRef = doc(db, "goals", user.uid);
        const userGoalsSnapshot = await getDoc(userGoalsRef);
        
        // Process goals data if it exists
        const goalsData = [];
        if (userGoalsSnapshot.exists()) {
          const goals = userGoalsSnapshot.data().goals || [];
          goals.forEach(goal => {
            if (goal.targetAmount && goal.currentAmount !== undefined) {
              const progressPercent = (goal.currentAmount / goal.targetAmount) * 100;
              goalsData.push({
                ...goal,
                progressPercent: Math.min(progressPercent, 100)
              });
            }
          });
        }
        setUserGoals(goalsData);
      } catch (error) {
        console.error("Error fetching goals:", error);
        // Continue with other data fetching even if goals fail
      }

      // Get transactions for trends
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const transactionsRef = collection(db, 'transactions');
      const q = query(
        transactionsRef,
        where('userId', '==', user.uid),
        where('timestamp', '>=', Timestamp.fromDate(threeMonthsAgo))
      );

      let transactions = [];
      try {
        const querySnapshot = await getDocs(q);
        transactions = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })).filter(data => data.amount && data.timestamp);
        
        console.log("Raw transactions loaded:", transactions.length); // Debug log
      } catch (error) {
        console.error('Error fetching transactions:', error);
        if (error.message.includes('permission') || error.code === 'permission-denied') {
          setError("Missing or insufficient permissions to access transaction data.");
          setLoading(false);
          return;
        }
      }

      // If no transactions, set empty data and stop loading
      if (transactions.length === 0) {
        console.log("No transactions found, using predicted data");
        setSpendingTrends([]);
        setMonthlyComparison([]);
        // Set default category distribution
        const defaultDistribution = Object.entries(DEFAULT_CATEGORIES).map(([name, percentage]) => ({
          name,
          value: DEFAULT_MONTHLY_BUDGET * percentage,
          percentage: percentage * 100
        }));
        setCategoryDistribution(defaultDistribution);
        setLoading(false);
        return;
      }

      // Process transactions for trends
      const dailySpending = {};
      const monthlySpending = {};
      
      transactions.forEach(transaction => {
        try {
          // Convert Firestore Timestamp to Date
          const transactionDate = transaction.timestamp.toDate();
          console.log("Processing transaction:", {
            date: transactionDate,
            amount: transaction.amount,
            category: transaction.category
          }); // Debug log

          // Daily spending - Format date as YYYY-MM-DD for consistent sorting
          const dateStr = transactionDate.toISOString().split('T')[0];
          dailySpending[dateStr] = (dailySpending[dateStr] || 0) + Number(transaction.amount);
          
          // Monthly spending - Format as "Month Year"
          const monthYear = transactionDate.toLocaleDateString('en-US', { 
            month: 'long',
            year: 'numeric'
          });
          
          if (!monthlySpending[monthYear]) {
            monthlySpending[monthYear] = {
              total: 0,
              categories: {}
            };
          }
          
          monthlySpending[monthYear].total += Number(transaction.amount);
          
          if (transaction.category) {
            monthlySpending[monthYear].categories[transaction.category] = 
              (monthlySpending[monthYear].categories[transaction.category] || 0) + 
              Number(transaction.amount);
          }
        } catch (err) {
          console.error('Error processing transaction:', err, transaction);
        }
      });

      // Format trend data with proper date sorting
      const trendData = Object.entries(dailySpending)
        .map(([date, amount]) => ({
          date: new Date(date).toLocaleDateString(),
          amount: Number(amount.toFixed(2))
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      console.log("Processed trend data:", trendData); // Debug log
      setSpendingTrends(trendData);

      // Format monthly comparison data with proper month sorting
      const monthlyComparisonData = Object.entries(monthlySpending)
        .map(([month, data]) => ({
          month,
          actual: Number(data.total.toFixed(2)),
          predicted: null,
          budget: Number((optimization?.currentBudget || DEFAULT_MONTHLY_BUDGET).toFixed(2))
        }))
        .sort((a, b) => {
          const [aMonth, aYear] = a.month.split(' ');
          const [bMonth, bYear] = b.month.split(' ');
          const aDate = new Date(`${aMonth} 1, ${aYear}`);
          const bDate = new Date(`${bMonth} 1, ${bYear}`);
          return aDate - bDate;
        });

      // Add predicted data for future months
      const predictedData = generatePredictedMonthlyData(optimization?.currentBudget || DEFAULT_MONTHLY_BUDGET);

      // Combine actual and predicted data
      const combinedData = [...monthlyComparisonData];
      
      // Add predicted data for months that don't have actual data
      predictedData.forEach(predicted => {
        const existingMonth = combinedData.find(item => item.month === predicted.month);
        if (!existingMonth) {
          combinedData.push(predicted);
        }
      });

      console.log("Processed monthly comparison data:", combinedData); // Debug log
      setMonthlyComparison(combinedData);

      // Process category distribution
      let distributionData;
      if (optimization?.recommendations) {
        distributionData = Object.entries(optimization.recommendations)
          .map(([category, data]) => ({
            name: category,
            value: Number(data.currentSpending.toFixed(2)),
            percentage: Number(data.percentageOfBudget)
          }));
      } else if (transactions.length === 0) {
        // If no transactions and no recommendations, use default categories
        distributionData = Object.entries(DEFAULT_CATEGORIES).map(([name, percentage]) => ({
          name,
          value: DEFAULT_MONTHLY_BUDGET * percentage,
          percentage: percentage * 100
        }));
      }

      console.log("Distribution data processed:", distributionData?.length); // Debug log
      if (distributionData) {
        setCategoryDistribution(distributionData);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      
      // Handle Firebase permission errors specifically
      if (error.message.includes('permission') || error.code === 'permission-denied') {
        setError("Missing or insufficient permissions. Please check your account settings and make sure you're properly logged in.");
      } else {
        setError('Failed to load budget insights. Please try again later.');
      }
      
      setDebugInfo({
        errorMessage: error.message,
        errorCode: error.code,
        errorStack: error.stack,
        timestamp: new Date().toISOString(),
        suggestion: error.message.includes('permission') ? 
          "This is likely due to Firebase security rules. Try logging out and logging back in, or contact the administrator." : 
          "Try refreshing the page or check your internet connection."
      });
      setLoading(false);
    }
  }, [initializeUserBudget, DEFAULT_CATEGORIES, DEFAULT_MONTHLY_BUDGET, optimization]);

  // Set up authentication listener and fetch data when user is authenticated
  useEffect(() => {
    console.log("Setting up auth listener"); // Debug log
    let authUnsubscribe;
    
    try {
      authUnsubscribe = auth.onAuthStateChanged(async (user) => {
        console.log("Auth state changed, user:", user?.uid); // Debug log
        
        if (!user) {
          console.log("No user found, redirecting to login"); // Debug log
          setLoading(false);
          setError("Please log in to view your budget insights.");
          navigate('/login');
          return;
        }

        // Only fetch data if we haven't already
        if (!dataFetched) {
          setCurrentUser(user);
          setLoading(true);
          setError(null);

          try {
            // Check permissions before fetching data
            const hasPermissions = await checkUserPermissions(user);
            console.log("User permissions checked:", hasPermissions); // Debug log

            if (!hasPermissions) {
              console.log("User lacks permissions, attempting to resolve..."); // Debug log
              const resolved = await handlePermissionError();
              console.log("Permission error handled, resolved:", resolved); // Debug log
              
              if (!resolved) {
                console.log("Permission error could not be resolved automatically");
                setLoading(false);
                return;
              }
            }

            console.log("Fetching dashboard data for user:", user.uid); // Debug log
            await fetchDashboardData(user);
            setDataFetched(true);
            
            // Check for goalId parameter in URL
            const urlParams = new URLSearchParams(window.location.search);
            const goalId = urlParams.get('goalId');
            
            if (goalId && userGoals.length > 0) {
              // Find the goal with matching ID
              const goalToEdit = userGoals.find(goal => goal.id === goalId);
              if (goalToEdit) {
                // Set this goal as the selected goal to open the modal
                setSelectedGoal(goalToEdit);
              }
            }
          } catch (error) {
            console.error("Error in auth state change handler:", error);
            if (error.code === 'auth/quota-exceeded') {
              setError("Too many authentication attempts. Please wait a few minutes and try again.");
            } else {
              setError("An error occurred while loading your data. Please try refreshing the page.");
            }
            setDebugInfo({
              errorMessage: error.message,
              errorCode: error.code,
              errorStack: error.stack,
              timestamp: new Date().toISOString()
            });
            setLoading(false);
          }
        }
      });
    } catch (error) {
      console.error("Error setting up auth listener:", error);
      if (error.code === 'auth/quota-exceeded') {
        setError("Too many authentication attempts. Please wait a few minutes and try again.");
      } else {
        setError("Failed to initialize the dashboard. Please refresh the page.");
      }
      setLoading(false);
    }

    return () => {
      console.log("Cleaning up auth listener"); // Debug log
      if (authUnsubscribe) {
        authUnsubscribe();
      }
    };
  }, [navigate, fetchDashboardData, checkUserPermissions, handlePermissionError, dataFetched, userGoals]);

  // Add a separate useEffect to handle the URL goalId parameter
  useEffect(() => {
    // Only run this when we have goals loaded
    if (userGoals.length > 0 && !selectedGoal) {
      // Check for goalId parameter in URL
      const urlParams = new URLSearchParams(window.location.search);
      const goalId = urlParams.get('goalId');
      
      if (goalId) {
        // Find the goal with matching ID
        const goalToEdit = userGoals.find(goal => goal.id === goalId);
        if (goalToEdit) {
          console.log("Found goal from URL parameter, opening modal", goalId);
          // Set this goal as the selected goal to open the modal
          setSelectedGoal(goalToEdit);
        }
      }
    }
  }, [userGoals, selectedGoal]);

  // Add a function to manually refresh data
  const handleManualRefresh = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    setError(null);
    try {
      await fetchDashboardData(currentUser);
    } catch (error) {
      console.error("Error refreshing data:", error);
      setError("Failed to refresh data. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  // Add these helper functions at the top of the component
  const generatePredictedDailyData = (monthlyBudget) => {
    const today = new Date();
    const data = [];
    
    // Generate daily predictions for the next 30 days
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(today.getDate() + i);
      data.push({
        date: date.toLocaleDateString(),
        amount: Number((monthlyBudget / 30).toFixed(2)),
        isPredicted: true
      });
    }
    return data;
  };

  const generatePredictedMonthlyData = (monthlyBudget) => {
    const today = new Date();
    const data = [];
    
    // Generate monthly predictions for the next 3 months
    for (let i = 0; i < 3; i++) {
      const date = new Date();
      date.setMonth(today.getMonth() + i);
      
      // Generate a random variation between 80% and 120% of the budget
      const variation = 0.8 + Math.random() * 0.4; // Random number between 0.8 and 1.2
      const predictedSpending = monthlyBudget * variation;
      
      data.push({
        month: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        actual: null,
        predicted: Number(predictedSpending.toFixed(2)),
        budget: Number(monthlyBudget.toFixed(2))
      });
    }
    return data;
  };

  // Add this new function to calculate efficiency metrics
  const calculateEfficiencyMetrics = useCallback(async () => {
    try {
      const usersRef = collection(db, 'users');
      const transactionsRef = collection(db, 'transactions');
      
      // Get all users with their budget data
      const usersSnapshot = await getDocs(usersRef);
      const users = {};
      usersSnapshot.docs.forEach(doc => {
        const userData = doc.data();
        users[doc.id] = {
          username: userData.username || 'Anonymous',
          budget: userData.budget || DEFAULT_MONTHLY_BUDGET,
          categories: userData.categories || []
        };
      });
      
      // Get all transactions from the last month
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      
      const q = query(
        transactionsRef,
        where('timestamp', '>=', Timestamp.fromDate(oneMonthAgo))
      );
      
      const querySnapshot = await getDocs(q);
      const transactions = querySnapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      }));
      
      // Calculate spending by user and category
      const userCategorySpending = {};
      
      transactions.forEach(transaction => {
        if (!transaction.amount || !transaction.userId) return;
        
        const userId = transaction.userId;
        const category = transaction.category || 'Other';
        const amount = Number(transaction.amount);
        
        if (!userCategorySpending[userId]) {
          userCategorySpending[userId] = {};
        }
        
        if (!userCategorySpending[userId][category]) {
          userCategorySpending[userId][category] = 0;
        }
        
        userCategorySpending[userId][category] += amount;
      });
      
      // Calculate efficiency metrics for each user and category
      const efficiencyMetrics = {};
      const categories = [...Object.keys(DEFAULT_CATEGORIES), 'Other'];
      
      categories.forEach(category => {
        efficiencyMetrics[category] = [];
        
        Object.entries(users).forEach(([userId, userData]) => {
          // Skip users with no transactions in this category
          if (!userCategorySpending[userId] || !userCategorySpending[userId][category]) {
            return;
          }
          
          const spending = userCategorySpending[userId][category];
          
          // Find the budget allocation for this category
          let allocation = 0;
          if (userData.categories && userData.categories.length > 0) {
            const categoryData = userData.categories.find(c => c.name === category);
            if (categoryData) {
              allocation = categoryData.allocation;
            } else if (category === 'Other') {
              allocation = userData.budget * 0.05; // Default 5% for Other
            }
          } else {
            // Use default allocation if user has no custom categories
            allocation = userData.budget * (DEFAULT_CATEGORIES[category] || 0.05);
          }
          
          // Calculate efficiency score (lower is better - percentage of budget used)
          const efficiencyScore = allocation > 0 ? (spending / allocation) * 100 : 100;
          
          efficiencyMetrics[category].push({
            userId,
            username: userData.username,
            spending,
            allocation,
            efficiencyScore,
            underBudget: spending <= allocation
          });
        });
        
        // Sort by efficiency (under budget users first, then by how much under budget)
        efficiencyMetrics[category].sort((a, b) => {
          // First sort by whether they're under budget
          if (a.underBudget !== b.underBudget) {
            return a.underBudget ? -1 : 1;
          }
          // Then sort by efficiency score (lower is better)
          return a.efficiencyScore - b.efficiencyScore;
        });
      });
      
      console.log("Calculated efficiency metrics:", efficiencyMetrics); // Debug log
      return efficiencyMetrics;
    } catch (error) {
      console.error('Error calculating efficiency metrics:', error);
      return {};
    }
  }, [DEFAULT_CATEGORIES, DEFAULT_MONTHLY_BUDGET]);

  // Add useEffect to fetch efficiency metrics
  useEffect(() => {
    if (auth.currentUser) {
      const fetchEfficiencyData = async () => {
        const metrics = await calculateEfficiencyMetrics();
        console.log("Setting efficiency metrics:", metrics); // Debug log
        setEfficiencyMetrics(metrics);
      };
      
      fetchEfficiencyData();
    }
  }, [calculateEfficiencyMetrics]);

  // Update the renderEfficiencyLeaderboard function
  const renderEfficiencyLeaderboard = () => {
    const categories = Object.keys(DEFAULT_CATEGORIES).concat('Other');
    
    return (
      <div className="dashboard-section efficiency-leaderboard-section">
        <h3>Budget Efficiency Champions</h3>
        <p className="leaderboard-description">
          See who's managing their budget most efficiently in each category.
          Lower percentages mean better budget management!
        </p>
        
        <div className="category-selector">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedMetricCategory(category)}
              className={`category-button ${selectedMetricCategory === category ? 'active' : ''}`}
            >
              {category}
            </button>
          ))}
        </div>
        
        <div className="efficiency-leaderboard">
          {efficiencyMetrics[selectedMetricCategory]?.length > 0 ? (
            <div className="leaderboard">
              <h4>{selectedMetricCategory} Budget Champions</h4>
              <div className="efficiency-leaderboard-list">
                {efficiencyMetrics[selectedMetricCategory].slice(0, 5).map((user, index) => (
                  <div 
                    key={user.userId} 
                    className={`efficiency-item rank-${index + 1} ${user.underBudget ? 'under-budget' : 'over-budget'}`}
                  >
                    <span className="rank">{index + 1}</span>
                    <span className="username">{user.username}</span>
                    <div className="efficiency-stats">
                      <div className="efficiency-bar-container">
                        <div 
                          className="efficiency-bar" 
                          style={{ 
                            width: `${Math.min(user.efficiencyScore, 100)}%`,
                            backgroundColor: user.underBudget ? '#00C49F' : '#FF8042'
                          }}
                        ></div>
                      </div>
                      <span className="efficiency-score">
                        {user.efficiencyScore.toFixed(0)}%
                      </span>
                    </div>
                    <div className="efficiency-details">
                      <span>£{user.spending.toFixed(0)} of £{user.allocation.toFixed(0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-leaderboard">
              <p>No efficiency data available for {selectedMetricCategory} category yet.</p>
              <button 
                onClick={() => navigate('/add-transaction')} 
                className="add-transaction-button"
              >
                Add Transaction
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Update the styles to remove leaderboard-related styles
  const styles = `
    .efficiency-leaderboard-section {
      margin-top: 2rem;
      background: #f9f9f9;
      padding: 1.5rem;
      border-radius: 10px;
    }

    .category-selector {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .category-button {
      padding: 0.5rem 1rem;
      border: 1px solid #ddd;
      border-radius: 20px;
      background: none;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .category-button.active {
      background: #0ef;
      color: white;
      border-color: #0ef;
    }

    .efficiency-leaderboard-list {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }

    .efficiency-item {
      display: flex;
      align-items: center;
      padding: 0.8rem;
      border-radius: 5px;
      background: white;
      flex-wrap: wrap;
    }

    .rank {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: #ddd;
      margin-right: 1rem;
      font-weight: bold;
    }

    .rank-1 .rank {
      background: gold;
      color: black;
    }

    .rank-2 .rank {
      background: silver;
      color: black;
    }

    .rank-3 .rank {
      background: #cd7f32;
      color: white;
    }

    .username {
      flex: 1;
      font-weight: 500;
    }

    .efficiency-stats {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0 1rem;
    }

    .efficiency-bar-container {
      flex: 1;
      height: 10px;
      background: #eee;
      border-radius: 5px;
      overflow: hidden;
    }

    .efficiency-bar {
      height: 100%;
      border-radius: 5px;
    }

    .efficiency-score {
      font-weight: bold;
      min-width: 45px;
      text-align: right;
    }

    .efficiency-details {
      font-size: 0.8rem;
      color: #666;
      width: 100%;
      margin-top: 0.5rem;
      padding-left: 45px;
    }

    .under-budget .efficiency-score {
      color: #00C49F;
    }

    .over-budget .efficiency-score {
      color: #FF8042;
    }

    .empty-leaderboard {
      text-align: center;
      padding: 2rem;
      background: #f8f9fa;
      border-radius: 10px;
    }

    .empty-leaderboard p {
      margin-bottom: 1rem;
      color: #666;
    }

    .add-transaction-button {
      background: #0ef;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .add-transaction-button:hover {
      background: #0cd;
      transform: translateY(-1px);
    }

    .leaderboard-description {
      margin-bottom: 1rem;
      color: #666;
      font-style: italic;
    }
  `;

  // Add this function to handle budget updates
  const handleBudgetUpdate = async () => {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');

      const totalBudget = parseFloat(newBudget);
      if (isNaN(totalBudget) || totalBudget <= 0) {
        throw new Error('Please enter a valid budget amount');
      }

      // Calculate category allocations
      const categoryAllocations = Object.entries(newCategoryBudgets).map(([category, percentage]) => ({
        name: category,
        allocation: totalBudget * (percentage / 100),
        percentage: percentage
      }));

      // Update user's budget in Firestore
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        budget: totalBudget,
        categories: categoryAllocations,
        lastUpdated: Timestamp.now()
      }, { merge: true });

      // Update local state
      setOptimization(prev => ({
        ...prev,
        currentBudget: totalBudget
      }));

      // Update monthly comparison data with new budget
      setMonthlyComparison(prev => prev.map(item => ({
        ...item,
        budget: totalBudget
      })));

      // Update spending trends with new budget predictions
      setSpendingTrends(prev => {
        const actualData = prev.filter(item => !item.isPredicted);
        const predictedData = generatePredictedDailyData(totalBudget);
        return [...actualData, ...predictedData];
      });

      setShowBudgetModal(false);
      setNewBudget('');
      setNewCategoryBudgets({});
      
      // Refresh the dashboard data
      await fetchDashboardData(user);
    } catch (error) {
      console.error('Error updating budget:', error);
      setError(error.message);
    }
  };

  // Add this function to render the budget management modal
  const renderBudgetModal = () => {
    if (!showBudgetModal) return null;

    return (
      <div className="modal-overlay">
        <div className="modal-content budget-modal">
          <h3>Update Your Budget</h3>
          <div className="budget-input-group">
            <label>Monthly Budget (£)</label>
            <input
              type="number"
              value={newBudget}
              onChange={(e) => setNewBudget(e.target.value)}
              placeholder="Enter your monthly budget"
              min="0"
              step="0.01"
            />
          </div>
          
          <div className="category-budgets">
            <h4>Category Allocations (%)</h4>
            {Object.entries(DEFAULT_CATEGORIES).map(([category, defaultPercentage]) => (
              <div key={category} className="category-budget-input">
                <label>{category}</label>
                <div className="budget-percent-input">
                  <input
                    type="number"
                    value={newCategoryBudgets[category] || defaultPercentage * 100}
                    onChange={(e) => setNewCategoryBudgets(prev => ({
                      ...prev,
                      [category]: parseFloat(e.target.value) || 0
                    }))}
                    min="0"
                    max="100"
                    step="0.1"
                  />
                  <span>%</span>
                </div>
              </div>
            ))}
          </div>

          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setShowBudgetModal(false)}>Cancel</button>
            <button className="primary-button" onClick={handleBudgetUpdate}>Update Budget</button>
          </div>
        </div>
      </div>
    );
  };

  // Function to add a new saving to a goal
  const addSavingToGoal = async (goalId, amount) => {
    try {
      if (!amount || isNaN(amount) || amount <= 0) {
        alert("Please enter a valid amount");
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        console.error("User not authenticated");
        alert("You must be logged in to update your goals. Please sign in and try again.");
        navigate('/login');
        return;
      }

      console.log("Adding saving to goal:", goalId);
      console.log("User ID:", user.uid);
      console.log("Amount:", amount);

      const parsedAmount = parseFloat(amount);
      const goalIndex = userGoals.findIndex(g => g.id === goalId);
      
      if (goalIndex === -1) {
        console.error("Goal not found:", goalId);
        alert("Goal not found. It may have been deleted.");
        return;
      }
      
      const goal = userGoals[goalIndex];
      const newAmount = goal.currentAmount + parsedAmount;
      const previousMilestones = goal.milestones ? goal.milestones.filter(m => m.amount <= goal.currentAmount) : [];
      
      console.log("Current amount:", goal.currentAmount);
      console.log("New amount after contribution:", newAmount);
      
      // Check for new milestones reached
      let newMilestoneReached = null;
      if (goal.milestones) {
        for (const milestone of goal.milestones) {
          if (milestone.amount > goal.currentAmount && milestone.amount <= newAmount) {
            newMilestoneReached = milestone;
            console.log("New milestone reached:", milestone.name);
            break;
          }
        }
      }
      
      // Update the goal in Firestore
      const userGoalsRef = doc(db, "goals", user.uid);
      console.log("Writing to document path:", userGoalsRef.path);
      
      // Get the current document first
      const userGoalsSnapshot = await getDoc(userGoalsRef);
      
      if (!userGoalsSnapshot.exists()) {
        console.error("Goals document doesn't exist");
        alert("Your goals data couldn't be found. Please try recreating your goal.");
        return;
      }
      
      const currentGoals = userGoalsSnapshot.data().goals || [];
      
      if (goalIndex >= currentGoals.length) {
        console.error("Goal index out of bounds");
        alert("There was an error updating your goal. Please refresh and try again.");
        return;
      }
      
      // Create an updated copy of the goals array
      const updatedGoals = [...currentGoals];
      
      // Update the specific goal with new values
      if (updatedGoals[goalIndex]) {
        updatedGoals[goalIndex] = {
          ...updatedGoals[goalIndex],
          currentAmount: newAmount,
          lastContribution: {
            amount: parsedAmount,
            date: new Date()
          }
        };
        
        // Add to contribution history if it exists, or create it
        if (!updatedGoals[goalIndex].contributionHistory) {
          updatedGoals[goalIndex].contributionHistory = [];
        }
        
        updatedGoals[goalIndex].contributionHistory.push({
          amount: parsedAmount,
          date: new Date(),
          milestoneReached: newMilestoneReached ? newMilestoneReached.name : null
        });
        
        // Update the entire goals array
        await updateDoc(userGoalsRef, {
          goals: updatedGoals
        });
        
        console.log("Goal updated successfully");
      } else {
        throw new Error("Goal data is invalid");
      }
      
      // Update local state
      const updatedLocalGoals = [...userGoals];
      updatedLocalGoals[goalIndex] = {
        ...goal,
        currentAmount: newAmount,
        progressPercent: Math.min((newAmount / goal.targetAmount) * 100, 100),
        lastContribution: {
          amount: parsedAmount,
          date: new Date()
        }
      };
      
      setUserGoals(updatedLocalGoals);
      setNewSavingAmount('');
      setSelectedGoal(null);
      
      // Show milestone celebration if a new milestone was reached
      if (newMilestoneReached) {
        setReachedMilestone(newMilestoneReached);
        setShowMilestoneModal(true);
        // Run confetti animation
        if (confettiRef.current) {
          // In a real implementation, you would trigger confetti here
          console.log("Confetti animation would play here!");
        }
      }
      
      alert("Contribution added successfully!");
      
    } catch (error) {
      console.error("Error adding saving to goal:", error);
      let errorMessage = "Failed to update goal. ";
      
      if (error.code === 'permission-denied') {
        errorMessage += "You don't have permission to update this goal.";
      } else if (error.code === 'unauthenticated') {
        errorMessage += "You are not authenticated. Please sign in again.";
        navigate('/login');
      } else if (error.code === 'unavailable') {
        errorMessage += "The service is temporarily unavailable. Please try again later.";
      } else {
        errorMessage += error.message || "Please try again.";
      }
      
      alert(errorMessage);
    }
  };
  
  // Default milestones for new goals
  const generateDefaultMilestones = (targetAmount) => {
    const milestones = [];
    const milestonePercentages = [25, 50, 75, 90];
    
    milestonePercentages.forEach(percentage => {
      const amount = (percentage / 100) * targetAmount;
      milestones.push({
        name: `${percentage}% Complete`,
        amount,
        description: `You've reached ${percentage}% of your goal!`,
        icon: percentage >= 75 ? '🏆' : percentage >= 50 ? '🌟' : '🎯'
      });
    });
    
    return milestones;
  };

  // Render the milestone celebration modal
  const renderMilestoneModal = () => {
    if (!showMilestoneModal || !reachedMilestone) return null;
    
    return (
      <div className="milestone-modal-overlay">
        <div className="milestone-modal">
          <div className="milestone-header">
            <span className="milestone-icon">{reachedMilestone.icon || '🎉'}</span>
            <h3>Milestone Reached!</h3>
          </div>
          <div className="milestone-content">
            <p className="milestone-name">{reachedMilestone.name}</p>
            <p className="milestone-description">{reachedMilestone.description}</p>
            <div className="milestone-amount">£{reachedMilestone.amount.toFixed(2)}</div>
          </div>
          <button 
            className="primary-button" 
            onClick={() => setShowMilestoneModal(false)}
          >
            Keep Going!
          </button>
          <div ref={confettiRef} className="confetti-container"></div>
        </div>
      </div>
    );
  };

  // Render the savings modal
  const renderSavingsModal = () => {
    if (!selectedGoal) return null;
    
    // Calculate next milestone
    let nextMilestone = null;
    if (selectedGoal.milestones) {
      for (const milestone of selectedGoal.milestones) {
        if (milestone.amount > selectedGoal.currentAmount) {
          nextMilestone = milestone;
          break;
        }
      }
    }
    
    const remainingAmount = selectedGoal.targetAmount - selectedGoal.currentAmount;
    const progressPercent = (selectedGoal.currentAmount / selectedGoal.targetAmount) * 100;
    
    return (
      <div className="modal-overlay">
        <div className="saving-modal">
          <h3>Add to Your Savings Goal</h3>
          <div className="saving-modal-content">
            <div className="goal-summary">
              <div className="goal-summary-row">
                <span>Goal:</span>
                <span>{selectedGoal.name}</span>
              </div>
              <div className="goal-summary-row">
                <span>Current savings:</span>
                <span>£{selectedGoal.currentAmount.toFixed(2)}</span>
              </div>
              <div className="goal-summary-row">
                <span>Target amount:</span>
                <span>£{selectedGoal.targetAmount.toFixed(2)}</span>
              </div>
              <div className="goal-summary-row">
                <span>Remaining:</span>
                <span>£{remainingAmount.toFixed(2)}</span>
              </div>
              <div className="goal-summary-row">
                <span>Progress:</span>
                <span>{progressPercent.toFixed(0)}%</span>
              </div>
              
              {nextMilestone && (
                <div className="next-milestone">
                  <span>Next milestone:</span>
                  <span>{nextMilestone.name} (£{nextMilestone.amount.toFixed(2)})</span>
                </div>
              )}
            </div>
            
            <div className="saving-input-group">
              <label>Contribution Amount (£):</label>
              <input
                type="number"
                value={newSavingAmount}
                onChange={(e) => setNewSavingAmount(e.target.value)}
                placeholder="Enter amount"
                min="0.01"
                step="0.01"
              />
            </div>
          </div>
          
          <div className="saving-modal-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setSelectedGoal(null);
                setNewSavingAmount('');
              }}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={() => addSavingToGoal(selectedGoal.id, newSavingAmount)}
              disabled={!newSavingAmount || parseFloat(newSavingAmount) <= 0}
            >
              Add to Savings
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    console.log("Rendering content. Loading:", loading, "Error:", error); // Debug log
    console.log("Data state - Trends:", spendingTrends.length, "Distribution:", categoryDistribution.length); // Debug log
    
    if (loading) {
      return (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading your budget insights...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="error-container">
          <h3>Oops! Something went wrong</h3>
          <p>{error}</p>
          {debugInfo && process.env.NODE_ENV === 'development' && (
            <div className="debug-info">
              <h4>Debug Information</h4>
              <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
            </div>
          )}
          <div className="error-actions">
            <button onClick={handleManualRefresh}>Refresh Data</button>
            <button onClick={() => navigate('/dashboard')}>Go to Dashboard</button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="dashboard-section">
          <div className="section-header">
            <h3>Budget Management</h3>
          </div>
          <div className="current-budget">
            <div className="budget-input-section">
              <div className="budget-input-group">
                <label>Monthly Budget (£)</label>
                <div className="budget-input-wrapper">
                  <input
                    type="number"
                    value={newBudget || optimization?.currentBudget || DEFAULT_MONTHLY_BUDGET}
                    onChange={(e) => setNewBudget(e.target.value)}
                    placeholder="Enter your monthly budget"
                    min="0"
                    step="0.01"
                  />
                  <button 
                    onClick={handleBudgetUpdate}
                    className="save-budget-button"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>

            <div className="budget-categories">
              {Object.entries(DEFAULT_CATEGORIES).map(([category, defaultPercentage]) => (
                <div key={category} className="budget-category">
                  <div className="category-header">
                    <span className="category-name">{category}</span>
                    <div className="category-input">
                      <input
                        type="number"
                        value={newCategoryBudgets[category] || defaultPercentage * 100}
                        onChange={(e) => setNewCategoryBudgets(prev => ({
                          ...prev,
                          [category]: parseFloat(e.target.value) || 0
                        }))}
                        min="0"
                        max="100"
                        step="0.1"
                      />
                      <span>%</span>
                    </div>
                  </div>
                  <div className="category-amount">
                    £{((newBudget || optimization?.currentBudget || DEFAULT_MONTHLY_BUDGET) * 
                      (newCategoryBudgets[category] || defaultPercentage * 100) / 100).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Milestone Tracker */}
        <div className="dashboard-section">
          <h3>Financial Goals Progress</h3>
          {userGoals.length > 0 ? (
            <>
              <div className="goals-container">
                {userGoals.map((goal, index) => (
                  <div key={index} className="goal-card">
                    <h3 className="goal-title">{goal.name}</h3>
                    <div className="goal-amounts">
                      <span className="current-amount">£{goal.currentAmount.toFixed(2)}</span>
                      <span className="target-amount">of £{goal.targetAmount.toFixed(2)}</span>
                    </div>
                    <div className="progress-bar-container">
                      <div 
                        className="progress-bar" 
                        style={{ width: `${goal.progressPercent}%` }}
                      ></div>
                    </div>
                    <div className="progress-percentage">{goal.progressPercent.toFixed(0)}% Complete</div>
                    {goal.targetDate && (
                      <div className="goal-date">
                        Target: {new Date(goal.targetDate).toLocaleDateString()}
                      </div>
                    )}
                    {goal.milestones && goal.milestones.length > 0 && (
                      <div className="milestones-preview">
                        {goal.milestones.map((milestone, idx) => {
                          const isReached = goal.currentAmount >= milestone.amount;
                          return (
                            <div 
                              key={idx} 
                              className={`milestone-dot ${isReached ? 'reached' : ''}`}
                              style={{ left: `${(milestone.amount / goal.targetAmount) * 100}%` }}
                              title={milestone.name}
                            >
                              {isReached && <span className="milestone-check">✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Add to savings button */}
                    <div className="add-saving-button-container">
                      <button 
                        className="add-saving-button" 
                        onClick={() => setSelectedGoal(goal)}
                      >
                        Add to Savings
                      </button>
                    </div>
                    
                    {/* Recent activity */}
                    {goal.lastContribution && (
                      <div className="last-contribution">
                        <span className="contribution-label">Last contribution: </span>
                        <span className="contribution-amount">£{goal.lastContribution.amount.toFixed(2)}</span>
                        <span className="contribution-date">
                          {new Date(goal.lastContribution.date).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="goals-actions">
                <button onClick={() => navigate("/goals")} className="secondary-button">
                  Manage Goals
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>You don't have any financial goals yet.</p>
              <button 
                onClick={() => navigate('/goals')} 
                className="add-goal-button"
              >
                Create a Goal
              </button>
            </div>
          )}
        </div>

        {/* Monthly Comparison */}
        <div className="dashboard-section monthly-comparison">
          <h3>Monthly Spending Comparison</h3>
          {monthlyComparison.length > 0 ? (
            <div className="chart-container monthly-chart">
            <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis 
                  dataKey="month"
                  tickFormatter={(month) => month.split(' ')[0]}
                    label={{ value: 'Month', position: 'insideBottom', offset: -5 }}
                    tick={{ fill: '#666' }}
                    axisLine={{ stroke: '#ccc' }}
                  />
                  <YAxis 
                    label={{ value: 'Amount (£)', angle: -90, position: 'insideLeft' }}
                    tick={{ fill: '#666' }}
                    axisLine={{ stroke: '#ccc' }}
                  />
                <Tooltip 
                    formatter={(value, name, props) => {
                      if (name === 'actual') {
                        return [`£${value.toFixed(2)}`, 'You spent'];
                      } else if (name === 'predicted') {
                        return [`£${value.toFixed(2)}`, 'Forecasted spending'];
                      } else if (name === 'budget') {
                        return [`£${value.toFixed(2)}`, 'Monthly budget limit'];
                      }
                      return [`£${value.toFixed(2)}`, name];
                    }}
                    labelFormatter={(month) => `${month}`}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #eee',
                      borderRadius: '8px',
                      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={36}
                    wrapperStyle={{
                      paddingBottom: '20px'
                    }}
                  />
                  <Bar 
                    dataKey="actual" 
                    fill="#8884d8"
                    name="You spent"
                    fillOpacity={1}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar 
                    dataKey="predicted" 
                    fill="#0ef"
                    name="Forecasted spending"
                    fillOpacity={0.5}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar 
                    dataKey="budget" 
                    fill="#00AAFF"
                    name="Monthly budget limit"
                    fillOpacity={0.3}
                    radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            </div>
          ) : (
            <div className="chart-container monthly-chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={generatePredictedMonthlyData(optimization?.currentBudget || DEFAULT_MONTHLY_BUDGET)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis 
                    dataKey="month"
                    tickFormatter={(month) => month.split(' ')[0]}
                    label={{ value: 'Month', position: 'insideBottom', offset: -5 }}
                    tick={{ fill: '#666' }}
                    axisLine={{ stroke: '#ccc' }}
                  />
                  <YAxis 
                    label={{ value: 'Amount (£)', angle: -90, position: 'insideLeft' }}
                    tick={{ fill: '#666' }}
                    axisLine={{ stroke: '#ccc' }}
                  />
                  <Tooltip 
                    formatter={(value, name, props) => {
                      if (name === 'predicted') {
                        return [`£${value.toFixed(2)}`, 'Forecasted spending'];
                      } else if (name === 'budget') {
                        return [`£${value.toFixed(2)}`, 'Monthly budget limit'];
                      }
                      return [`£${value.toFixed(2)}`, name];
                    }}
                    labelFormatter={(month) => `${month}`}
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #eee',
                      borderRadius: '8px',
                      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={36}
                    wrapperStyle={{
                      paddingBottom: '20px'
                    }}
                  />
                  <Bar 
                    dataKey="predicted" 
                    fill="#0ef"
                    name="Forecasted spending"
                    fillOpacity={0.5}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar 
                    dataKey="budget" 
                    fill="#00AAFF"
                    name="Monthly budget limit"
                    fillOpacity={0.3}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="prediction-note">
                <p>* Showing forecasted monthly spending based on your budget limit of £{optimization?.currentBudget || DEFAULT_MONTHLY_BUDGET}</p>
              </div>
            </div>
          )}
        </div>

        {/* Category Distribution */}
        <div className="dashboard-section">
          <h3>Spending Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart style={{ background: 'transparent' }}>
              <Pie
                data={categoryDistribution.length > 0 ? categoryDistribution : Object.entries(DEFAULT_CATEGORIES).map(([name, percentage]) => ({
                  name,
                  value: DEFAULT_MONTHLY_BUDGET * percentage,
                  percentage: percentage * 100
                }))}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percentage }) => `${name} (${percentage}%)`}
              >
                {(categoryDistribution.length > 0 ? categoryDistribution : Object.entries(DEFAULT_CATEGORIES).map(([name, percentage]) => ({
                  name,
                  value: DEFAULT_MONTHLY_BUDGET * percentage,
                  percentage: percentage * 100
                }))).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `£${value.toFixed(2)}`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          {categoryDistribution.length === 0 && (
            <div className="empty-state">
              <p>No spending data available yet.</p>
              <button 
                onClick={() => navigate('/add-transaction')} 
                className="add-transaction-button"
              >
                Add Transaction
              </button>
            </div>
          )}
        </div>

        {/* Detailed Recommendations */}
        {optimization?.recommendations && (
          <div className="dashboard-section">
            <h3>Category Analysis</h3>
            <div className="recommendations-container">
              {Object.entries(optimization.recommendations).map(([category, data]) => (
                <div key={category} className="category-recommendation">
                  <h4>{category}</h4>
                  <div className="recommendation-stats">
                    <div className="stat">
                      <label>Current Monthly</label>
                      <span>£{data.currentSpending.toFixed(2)}</span>
                    </div>
                    <div className="stat">
                      <label>Suggested</label>
                      <span>£{data.suggestedAllocation.toFixed(2)}</span>
                    </div>
                    <div className="stat">
                      <label>Budget %</label>
                      <span>{data.percentageOfBudget}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {renderEfficiencyLeaderboard()}
        
        {renderBudgetModal()}
        
        {/* Add Saving Modal */}
        {selectedGoal && (
          <div className="modal-overlay">
            <div className="saving-modal">
              <h3>Add to {selectedGoal.name}</h3>
              <div className="saving-modal-content">
                <div className="saving-input-group">
                  <label>Amount (£)</label>
                  <input 
                    type="number" 
                    value={newSavingAmount} 
                    onChange={(e) => setNewSavingAmount(e.target.value)}
                    placeholder="Enter amount"
                    min="0.01"
                    step="0.01"
                    autoFocus
                  />
                </div>
                <div className="goal-summary">
                  <div className="goal-summary-row">
                    <span>Current amount:</span>
                    <span>£{selectedGoal.currentAmount.toFixed(2)}</span>
                  </div>
                  <div className="goal-summary-row">
                    <span>Target amount:</span>
                    <span>£{selectedGoal.targetAmount.toFixed(2)}</span>
                  </div>
                  <div className="goal-summary-row">
                    <span>Remaining:</span>
                    <span>£{(selectedGoal.targetAmount - selectedGoal.currentAmount).toFixed(2)}</span>
                  </div>
                  {selectedGoal.milestones && selectedGoal.milestones.length > 0 && (
                    <div className="next-milestone">
                      <span>Next milestone:</span>
                      {selectedGoal.milestones.find(m => m.amount > selectedGoal.currentAmount) ? (
                        <span>{selectedGoal.milestones.find(m => m.amount > selectedGoal.currentAmount).name} 
                          (£{selectedGoal.milestones.find(m => m.amount > selectedGoal.currentAmount).amount.toFixed(2)})
                        </span>
                      ) : (
                        <span>All milestones reached!</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="saving-modal-actions">
                <button 
                  className="secondary-button" 
                  onClick={() => {
                    setSelectedGoal(null);
                    setNewSavingAmount('');
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="primary-button" 
                  onClick={() => addSavingToGoal(selectedGoal.id, newSavingAmount)}
                  disabled={!newSavingAmount || isNaN(newSavingAmount) || parseFloat(newSavingAmount) <= 0}
                >
                  Add Saving
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Milestone Celebration Modal */}
        {renderMilestoneModal()}
        
        {/* Savings Modal */}
        {renderSavingsModal()}
        
        <style>{`
          ${styles}
          
          /* Budget Management Styles */
          .dashboard-section {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 30px;
          }
          
          .section-header h3 {
            color: #19e6ff;
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 1.5rem;
          }
          
          .current-budget {
            margin-bottom: 20px;
          }
          
          .budget-input-section {
            margin-bottom: 24px;
            background: rgba(0, 0, 0, 0.2);
            padding: 16px;
            border-radius: 8px;
          }
          
          .budget-input-group {
            margin-bottom: 12px;
          }
          
          .budget-input-group label {
            display: block;
            margin-bottom: 8px;
            color: #e0e0e0;
            font-size: 1rem;
          }
          
          .budget-input-wrapper {
            display: flex;
            gap: 10px;
          }
          
          .budget-input-wrapper input {
            flex: 1;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 12px;
            font-size: 1rem;
            color: white;
          }
          
          .budget-input-wrapper input:focus {
            outline: none;
            border-color: #19e6ff;
            box-shadow: 0 0 0 2px rgba(25, 230, 255, 0.2);
          }
          
          .save-budget-button {
            background: linear-gradient(135deg, #19e6ff 0%, #0ef 100%);
            color: #23262b;
            border: none;
            border-radius: 8px;
            padding: 0 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
          }
          
          .save-budget-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 238, 255, 0.3);
          }
          
          .budget-categories {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 16px;
          }
          
          .budget-category {
            background: rgba(0, 0, 0, 0.15);
            border-radius: 10px;
            padding: 16px;
            transition: all 0.3s;
          }
          
          .budget-category:hover {
            background: rgba(0, 0, 0, 0.25);
            transform: translateY(-2px);
          }
          
          .category-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
          }
          
          .category-name {
            font-weight: 500;
            color: #e0e0e0;
          }
          
          .category-input {
            display: flex;
            align-items: center;
          }
          
          .category-input input {
            width: 60px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            padding: 6px;
            color: white;
            margin-right: 4px;
            text-align: right;
          }
          
          .category-input input:focus {
            outline: none;
            border-color: #19e6ff;
          }
          
          .category-input span {
            color: #a0a0a0;
          }
          
          .category-amount {
            font-size: 1.2rem;
            color: #19e6ff;
            font-weight: 600;
            margin-top: 8px;
            text-align: right;
          }

          /* Goals Styles */
          .goals-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 24px;
            margin-bottom: 24px;
          }
          
          .goal-card {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 20px;
            transition: transform 0.3s;
          }
          
          .goal-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
          }
          
          .goal-title {
            font-size: 1.3rem;
            color: #ffffff;
            margin-bottom: 15px;
          }
          
          .goal-amounts {
            display: flex;
            align-items: baseline;
            margin-bottom: 10px;
          }
          
          .current-amount {
            font-size: 1.5rem;
            font-weight: 600;
            color: #19e6ff;
            margin-right: 5px;
          }
          
          .target-amount {
            color: #a0a0a0;
            font-size: 1rem;
          }
          
          .progress-bar-container {
            height: 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 5px;
            overflow: hidden;
            margin-bottom: 10px;
          }
          
          .progress-bar {
            height: 100%;
            background: linear-gradient(to right, #0088FE, #19e6ff);
            border-radius: 5px;
            transition: width 1s ease-in-out;
          }
          
          .progress-percentage {
            color: #e0e0e0;
            font-size: 0.9rem;
            margin-bottom: 10px;
          }
          
          .goal-date {
            color: #a0a0a0;
            font-size: 0.9rem;
            font-style: italic;
          }
          
          .goals-actions {
            display: flex;
            justify-content: center;
            margin-top: 10px;
          }
          
          /* Milestone styles */
          .milestones-preview {
            position: relative;
            height: 20px;
            margin: 5px 0 15px;
          }
          
          .milestone-dot {
            position: absolute;
            width: 16px;
            height: 16px;
            background: rgba(255, 255, 255, 0.2);
            border: 2px solid rgba(255, 255, 255, 0.4);
            border-radius: 50%;
            transform: translateX(-50%);
            cursor: pointer;
            transition: all 0.3s;
          }
          
          .milestone-dot.reached {
            background: rgba(0, 196, 159, 0.8);
            border-color: #00C49F;
          }
          
          .milestone-check {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 10px;
          }
          
          .milestone-dot:hover::after {
            content: attr(title);
            position: absolute;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: #23262b;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            z-index: 10;
          }
          
          .add-saving-button-container {
            margin: 15px 0;
            text-align: center;
          }
          
          .add-saving-button {
            background: rgba(0, 196, 159, 0.2);
            color: #00C49F;
            border: 1px solid #00C49F;
            border-radius: 20px;
            padding: 8px 16px;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s;
          }
          
          .add-saving-button:hover {
            background: rgba(0, 196, 159, 0.3);
            transform: translateY(-2px);
          }
          
          .last-contribution {
            font-size: 0.9rem;
            color: #a0a0a0;
            margin-top: 10px;
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
          }
          
          .contribution-amount {
            color: #00C49F;
            font-weight: 600;
          }
          
          .contribution-date {
            font-style: italic;
          }
          
          /* Modal styles for saving */
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
          }
          
          .saving-modal {
            background: #2a2f3a;
            border-radius: 16px;
            width: 90%;
            max-width: 500px;
            padding: 24px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
          }
          
          .saving-modal h3 {
            color: #19e6ff;
            text-align: center;
            margin-bottom: 20px;
          }
          
          .saving-modal-content {
            margin-bottom: 24px;
          }
          
          .saving-input-group {
            margin-bottom: 20px;
          }
          
          .saving-input-group label {
            display: block;
            margin-bottom: 8px;
            font-size: 1rem;
            color: #e0e0e0;
          }
          
          .saving-input-group input {
            width: 100%;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 12px;
            font-size: 1.1rem;
            color: white;
            transition: all 0.3s;
          }
          
          .saving-input-group input:focus {
            border-color: #19e6ff;
            outline: none;
            box-shadow: 0 0 0 2px rgba(25, 230, 255, 0.2);
          }
          
          .goal-summary {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            padding: 16px;
          }
          
          .goal-summary-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            color: #e0e0e0;
          }
          
          .next-milestone {
            display: flex;
            justify-content: space-between;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            color: #00C49F;
          }
          
          .saving-modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
          }
          
          /* Milestone celebration modal */
          .milestone-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
          }
          
          .milestone-modal {
            background: #2a2f3a;
            border-radius: 16px;
            width: 90%;
            max-width: 450px;
            padding: 30px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            position: relative;
            overflow: hidden;
          }
          
          .milestone-header {
            margin-bottom: 20px;
          }
          
          .milestone-icon {
            font-size: 3rem;
            display: block;
            margin-bottom: 10px;
          }
          
          .milestone-modal h3 {
            font-size: 1.8rem;
            color: #19e6ff;
            margin: 0;
          }
          
          .milestone-content {
            margin-bottom: 30px;
          }
          
          .milestone-name {
            font-size: 1.4rem;
            color: white;
            margin-bottom: 10px;
          }
          
          .milestone-description {
            color: #e0e0e0;
            margin-bottom: 20px;
          }
          
          .milestone-amount {
            font-size: 2rem;
            font-weight: 700;
            color: #00C49F;
            margin-bottom: 20px;
          }
          
          .confetti-container {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 100%;
            pointer-events: none;
          }
          
          /* Empty state */
          .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
          }
          
          .empty-state p {
            color: #e0e0e0;
            margin-bottom: 20px;
            font-size: 1.1rem;
          }
          
          .add-goal-button {
            background: rgba(0, 196, 159, 0.2);
            color: #00C49F;
            border: 1px solid #00C49F;
            border-radius: 20px;
            padding: 10px 20px;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s;
          }
          
          .add-goal-button:hover {
            background: rgba(0, 196, 159, 0.3);
            transform: translateY(-2px);
          }

          /* Add goal button hover */
          .add-goal-button:hover {
            background: rgba(0, 196, 159, 0.3);
            transform: translateY(-2px);
          }

          /* Monthly Comparison Styles */
          .monthly-comparison {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 30px;
          }
          
          .monthly-comparison h3 {
            color: #19e6ff;
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 1.5rem;
          }
          
          .monthly-chart {
            background: rgba(0, 0, 0, 0.15);
            border-radius: 10px;
            padding: 20px;
            margin-top: 15px;
          }
          
          .prediction-note {
            margin-top: 15px;
            text-align: center;
            font-style: italic;
            color: #a0a0a0;
            font-size: 0.9rem;
          }
          
          /* Fix default elements to match theme */
          .recharts-tooltip-cursor {
            fill: rgba(0, 0, 0, 0.1) !important;
          }
          
          .recharts-default-tooltip {
            background-color: rgba(42, 47, 58, 0.95) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 8px !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
            padding: 12px !important;
          }
          
          .recharts-tooltip-label {
            color: white !important;
            font-weight: 500 !important;
            margin-bottom: 6px !important;
          }
          
          .recharts-tooltip-item {
            color: #e0e0e0 !important;
          }
          
          .recharts-tooltip-item-name {
            color: #a0a0a0 !important;
          }
          
          .recharts-tooltip-item-value {
            color: #19e6ff !important;
            font-weight: 600 !important;
          }
          
          /* Budget Modal Styles */
          .budget-modal {
            background: #2a2f3a;
            border-radius: 16px;
            width: 90%;
            max-width: 600px;
            padding: 30px;
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
          }
          
          .budget-modal h3 {
            color: #19e6ff;
            text-align: center;
            font-size: 1.8rem;
            margin-bottom: 25px;
          }
          
          .budget-modal h4 {
            color: #e0e0e0;
            margin: 20px 0 15px;
            font-size: 1.2rem;
          }
          
          .category-budgets {
            margin-top: 25px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            padding: 16px;
          }
          
          .category-budget-input {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          }
          
          .category-budget-input:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
          }
          
          .category-budget-input label {
            color: #e0e0e0;
            font-size: 1rem;
          }
          
          .budget-percent-input {
            display: flex;
            align-items: center;
          }
          
          .budget-percent-input input {
            width: 65px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 6px;
            padding: 8px;
            color: white;
            font-size: 1rem;
            text-align: right;
          }
          
          .budget-percent-input input:focus {
            outline: none;
            border-color: #19e6ff;
            box-shadow: 0 0 0 2px rgba(25, 230, 255, 0.2);
          }
          
          .budget-percent-input span {
            margin-left: 6px;
            color: #a0a0a0;
          }
          
          .modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 15px;
            margin-top: 30px;
          }
          
          .primary-button,
          .secondary-button {
            padding: 12px 24px;
            border-radius: 30px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
          }
          
          .primary-button {
            background: linear-gradient(135deg, #19e6ff 0%, #0ef 100%);
            color: #23262b;
            border: none;
          }
          
          .secondary-button {
            background: rgba(255, 255, 255, 0.1);
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          
          .primary-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 238, 255, 0.3);
          }
          
          .secondary-button:hover {
            background: rgba(255, 255, 255, 0.15);
            border-color: #19e6ff;
          }
          
          .primary-button:disabled {
            background: #616161;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
          }
        `}</style>
      </>
    );
  };

  return (
    <div className="budget-dashboard">
      <h2>Budget Optimization Dashboard</h2>

      {/* Optimization Alerts */}
      {optimization?.needsOptimization && (
        <div className="dashboard-alerts">
          {getSpendingAlerts(optimization).map((alert, index) => (
            <div key={index} className={`alert alert-${alert.type}`}>
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Main Content */}
      {renderContent()}

      {/* Budget Modal */}
      {renderBudgetModal()}
      
      {/* Milestone Modal */}
      {renderMilestoneModal()}
      
      {/* Savings Modal */}
      {renderSavingsModal()}

      <style>{`
        .budget-dashboard {
          max-width: 1200px;
          margin: 0 auto;
          padding: 30px 20px;
        }
        
        .budget-dashboard h2 {
          color: #19e6ff;
          font-size: 2.2rem;
          margin-bottom: 30px;
          text-align: center;
        }
        
        .dashboard-alerts {
          margin-bottom: 30px;
        }
        
        .alert {
          padding: 15px 20px;
          border-radius: 10px;
          margin-bottom: 15px;
          font-size: 1rem;
          line-height: 1.5;
        }
        
        .alert-warning {
          background: rgba(255, 171, 0, 0.15);
          border-left: 4px solid #ffab00;
          color: #ffab00;
        }
        
        .alert-info {
          background: rgba(25, 230, 255, 0.15);
          border-left: 4px solid #19e6ff;
          color: #19e6ff;
        }
        
        .alert-danger {
          background: rgba(255, 100, 100, 0.15);
          border-left: 4px solid #ff6464;
          color: #ff6464;
        }
        
        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 0;
          text-align: center;
        }
        
        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 4px solid rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          border-left-color: #19e6ff;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .loading-container p {
          color: #19e6ff;
          font-size: 1.2rem;
        }
        
        .error-container {
          background: rgba(255, 100, 100, 0.1);
          border-radius: 16px;
          padding: 40px 30px;
          text-align: center;
          max-width: 600px;
          margin: 0 auto;
        }
        
        .error-container h3 {
          color: #ff6464;
          font-size: 1.8rem;
          margin-bottom: 15px;
        }
        
        .error-container p {
          color: #e0e0e0;
          margin-bottom: 25px;
          line-height: 1.6;
        }
        
        .error-actions {
          display: flex;
          justify-content: center;
          gap: 15px;
        }
        
        .error-actions button {
          padding: 10px 20px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
          border: 1px solid rgba(255, 255, 255, 0.2);
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .error-actions button:hover {
          background: rgba(25, 230, 255, 0.2);
          border-color: #19e6ff;
          color: #19e6ff;
          transform: translateY(-2px);
        }
        
        .debug-info {
          margin-top: 20px;
          margin-bottom: 25px;
          text-align: left;
          padding: 15px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
          max-height: 200px;
          overflow-y: auto;
        }
        
        .debug-info h4 {
          color: #a0a0a0;
          margin-bottom: 10px;
          font-size: 0.9rem;
        }
        
        .debug-info pre {
          color: #a0a0a0;
          font-size: 0.8rem;
          overflow-x: auto;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
      `}</style>
    </div>
  );
};

export default BudgetDashboard; 