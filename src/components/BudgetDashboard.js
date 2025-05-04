import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { db, auth } from "../firebase-config";
import { collection, query, where, getDocs, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
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

  // Use useMemo for arrays to prevent unnecessary re-renders
  const COLORS = useMemo(() => 
    ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#0ef', '#ff69b4', '#ba55d3']
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
          total: Number(data.total.toFixed(2)),
          ...Object.fromEntries(
            Object.entries(data.categories).map(([cat, val]) => [
              cat,
              Number(val.toFixed(2))
            ])
          )
        }))
        .sort((a, b) => {
          const [aMonth, aYear] = a.month.split(' ');
          const [bMonth, bYear] = b.month.split(' ');
          const aDate = new Date(`${aMonth} 1, ${aYear}`);
          const bDate = new Date(`${bMonth} 1, ${bYear}`);
          return aDate - bDate;
        });

      console.log("Processed monthly comparison data:", monthlyComparisonData); // Debug log
      setMonthlyComparison(monthlyComparisonData);

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
  }, [navigate, fetchDashboardData, checkUserPermissions, handlePermissionError, dataFetched]);

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
      data.push({
        month: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        total: monthlyBudget,
        isPredicted: true
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
        setEfficiencyMetrics(metrics);
      };
      
      fetchEfficiencyData();
    }
  }, [calculateEfficiencyMetrics]);

  // Add a new function to render the efficiency leaderboard
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

    // Show predicted data if no actual data exists
    const showPredictedData = (!spendingTrends || spendingTrends.length === 0);
    const trendData = showPredictedData ? generatePredictedDailyData(DEFAULT_MONTHLY_BUDGET) : spendingTrends;
    const monthlyData = showPredictedData ? generatePredictedMonthlyData(DEFAULT_MONTHLY_BUDGET) : monthlyComparison;

    return (
      <>
        <div className="dashboard-section">
          <h3>Spending Trends</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date"
                  tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis />
                <Tooltip 
                  formatter={(value, name, props) => {
                    const prefix = props.payload.isPredicted ? 'Predicted: ' : '';
                    return [`${prefix}£${value.toFixed(2)}`, 'Daily Spending'];
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="#8884d8" 
                  activeDot={{ r: 8 }}
                  name="Daily Spending"
                  strokeDasharray={trendData[0]?.isPredicted ? "5 5" : "0"}
                />
              </LineChart>
            </ResponsiveContainer>
            {showPredictedData && (
              <div className="prediction-note">
                <p>* Showing predicted spending. Add transactions to see your actual spending patterns.</p>
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

        {/* Monthly Comparison */}
        <div className="dashboard-section">
          <h3>Monthly Spending Comparison</h3>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="month"
                  tickFormatter={(month) => month.split(' ')[0]}
                />
                <YAxis />
                <Tooltip 
                  formatter={(value, name, props) => {
                    const prefix = props.payload.isPredicted ? 'Predicted: ' : '';
                    return [`${prefix}£${value.toFixed(2)}`, 'Monthly Spending'];
                  }}
                />
                <Legend />
                <Bar 
                  dataKey="total" 
                  fill="#0ef"
                  name="Monthly Spending"
                  fillOpacity={monthlyData[0]?.isPredicted ? 0.5 : 1}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={generatePredictedMonthlyData(DEFAULT_MONTHLY_BUDGET)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="month"
                    tickFormatter={(month) => month.split(' ')[0]}
                  />
                  <YAxis />
                  <Tooltip 
                    formatter={(value) => [`Predicted: £${value.toFixed(2)}`, 'Monthly Spending']}
                  />
                  <Legend />
                  <Bar 
                    dataKey="total" 
                    fill="#0ef"
                    fillOpacity={0.5}
                    name="Predicted Monthly Spending"
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="prediction-note">
                <p>* Showing predicted monthly spending based on your budget of £{DEFAULT_MONTHLY_BUDGET}</p>
              </div>
            </div>
          )}
        </div>

        {/* Category Distribution */}
        <div className="dashboard-section">
          <h3>Spending Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={categoryDistribution}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percentage }) => `${name} (${percentage}%)`}
              >
                {categoryDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `£${value.toFixed(2)}`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
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
        
        <style>{styles}</style>
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

      {renderContent()}
    </div>
  );
};

export default BudgetDashboard; 