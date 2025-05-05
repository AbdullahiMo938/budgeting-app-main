import React, { useEffect, useState, useMemo } from "react";
import { db } from "./firebase-config";
import { collection, onSnapshot, doc, getDoc, query, where, getDocs, setDoc } from "firebase/firestore";
import "./App.css";
import "./leaderboard.css";
import { auth } from "./firebase-config";
import { useNavigate } from "react-router-dom";

const AllStats = () => {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showOnlyFriends, setShowOnlyFriends] = useState(false);
  const [friends, setFriends] = useState([]);
  const [usernames, setUsernames] = useState({});
  const [debugInfo, setDebugInfo] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [categoryStats, setCategoryStats] = useState({});
  const [selectedCategory, setSelectedCategory] = useState('All');
  const navigate = useNavigate();

  // Define default categories
  const DEFAULT_CATEGORIES = useMemo(() => ([
    'Housing',
    'Transportation',
    'Food',
    'Utilities',
    'Entertainment',
    'Savings',
    'Personal',
    'Other'
  ]), []);

  useEffect(() => {
    let unsubscribeStats = null;
    let unsubscribeUser = null;
    let unsubscribeAuth = null;
    let unsubscribeTransactions = null;

    const setupRealTimeUpdates = async () => {
      try {
        setLoading(true);
        setError(null);
        setDebugInfo(null);

        const user = auth.currentUser;
        if (!user) {
          throw new Error('User not authenticated');
        }

        // Debug info object to track the process
        const debug = {
          userId: user.uid,
          timestamp: new Date().toISOString(),
          steps: []
        };

        // Step 1: Set up real-time listener for user document (for friends list)
        unsubscribeUser = onSnapshot(
          doc(db, 'users', user.uid),
          async (userDoc) => {
            if (userDoc.exists()) {
              // Fetch friends from subcollection
              const friendsSnapshot = await getDocs(collection(db, 'users', user.uid, 'friends'));
              const friendsList = friendsSnapshot.docs.map(doc => doc.id);
              setFriends(friendsList);
              debug.steps.push({
                step: 'Real-time user update',
                success: true,
                friendsCount: friendsList.length,
                friendsList: friendsList // Add this for debugging
              });
            }
          },
          (error) => {
            console.error('Error in user listener:', error);
            debug.steps.push({
              step: 'Real-time user update',
              success: false,
              error: error.message
            });
          }
        );

        // Step 2: Set up real-time listener for spending stats
        unsubscribeStats = onSnapshot(
          collection(db, 'spendingStats'),
          async (snapshot) => {
            try {
              debug.steps.push({
                step: 'Real-time stats update',
                success: true,
                statsCount: snapshot.size
              });

              // Get unique user IDs from stats
              const userIds = [...new Set(snapshot.docs.map(doc => doc.data().userId))];

              // Fetch usernames for each user
              const usernamePromises = userIds.map(async userId => {
                try {
                  const userDoc = await getDoc(doc(db, 'users', userId));
                  if (!userDoc.exists()) {
                    console.warn(`No user document found for userId: ${userId}`);
                    return { userId, username: `User-${userId.slice(0, 4)}` };
                  }
                  
                  const userData = userDoc.data();
                  if (!userData.username) {
                    console.warn(`No username set for userId: ${userId}`);
                    return { userId, username: `User-${userId.slice(0, 4)}` };
                  }
                  
                  return { userId, username: userData.username };
                } catch (error) {
                  console.error(`Error fetching username for ${userId}:`, error);
                  return { userId, username: `User-${userId.slice(0, 4)}` };
                }
              });

              const usernameResults = await Promise.all(usernamePromises);
              const newUsernames = {};
              usernameResults.forEach(result => {
                newUsernames[result.userId] = result.username;
              });

              setUsernames(newUsernames);

              const statsData = snapshot.docs.map(doc => {
                const data = doc.data();
                const userId = data.userId;
                const isFriend = friends.includes(userId);
                const isCurrentUser = userId === user.uid;

                return {
                  id: doc.id,
                  userId,
                  username: newUsernames[userId] || `User-${userId.slice(0, 4)}`,
                  totalSpending: data.totalSpending || 0,
                  lastUpdated: data.lastUpdated?.toDate() || new Date(),
                  isFriend,
                  isCurrentUser
                };
              });

              // Sort stats by total spending
              const sortedStats = statsData.sort((a, b) => b.totalSpending - a.totalSpending);
              setStats(sortedStats);
              
              // Update category stats with friend status
              const updatedCategoryStats = { ...categoryStats };
              Object.keys(updatedCategoryStats).forEach(category => {
                updatedCategoryStats[category] = updatedCategoryStats[category].map(stat => ({
                  ...stat,
                  isFriend: friends.includes(stat.userId),
                  isCurrentUser: stat.userId === user.uid
                }));
              });
              setCategoryStats(updatedCategoryStats);

              debug.steps.push({
                step: 'Final processing',
                success: true,
                processedStats: statsData.length
              });
              setDebugInfo(debug);
              setLoading(false);
            } catch (error) {
              console.error('Error processing stats update:', error);
              debug.steps.push({
                step: 'Stats processing',
                success: false,
                error: error.message
              });
              setDebugInfo(debug);
              setLoading(false);
            }
          },
          (error) => {
            console.error('Error in stats listener:', error);
            setError('Failed to load leaderboard data');
            setDebugInfo({
              error: error.message,
              stack: error.stack,
              timestamp: new Date().toISOString()
            });
            setLoading(false);
          }
        );

        // Step 3: Set up real-time listener for transactions to get category stats
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        
        unsubscribeTransactions = onSnapshot(
          query(
            collection(db, 'transactions'),
            where('timestamp', '>=', threeMonthsAgo)
          ),
          async (snapshot) => {
            try {
              debug.steps.push({
                step: 'Real-time transactions update',
                success: true,
                transactionsCount: snapshot.size
              });

              // Process transactions by category
              const categoryData = {};
              DEFAULT_CATEGORIES.forEach(category => {
                categoryData[category] = {};
              });
              categoryData['All'] = {};

              // First pass: Calculate total spending per user
              const userTotalSpending = {};
              snapshot.docs.forEach(doc => {
                const transaction = doc.data();
                if (!transaction.amount || !transaction.userId) return;

                const userId = transaction.userId;
                const amount = Number(transaction.amount);

                if (!userTotalSpending[userId]) {
                  userTotalSpending[userId] = 0;
                }
                userTotalSpending[userId] += amount;
              });

              // Second pass: Calculate category percentages
              snapshot.docs.forEach(doc => {
                const transaction = doc.data();
                if (!transaction.amount || !transaction.userId) return;

                const userId = transaction.userId;
                const category = transaction.category || 'Other';
                const amount = Number(transaction.amount);
                const totalSpending = userTotalSpending[userId] || 1; // Avoid division by zero

                // Calculate percentage for this transaction
                const percentage = (amount / totalSpending) * 100;

                // Process for specific category
                if (!categoryData[category]) {
                  categoryData[category] = {};
                }
                if (!categoryData[category][userId]) {
                  categoryData[category][userId] = 0;
                }
                categoryData[category][userId] += percentage;

                // Process for All categories (average percentage across all categories)
                if (!categoryData['All'][userId]) {
                  categoryData['All'][userId] = 0;
                }
                categoryData['All'][userId] += percentage;
              });

              // Create leaderboards for each category
              const categoryLeaderboards = {};
              
              Object.entries(categoryData).forEach(([category, userData]) => {
                if (category === 'All') {
                  // For All category, use actual spending amounts
                  categoryLeaderboards[category] = Object.entries(userTotalSpending)
                    .map(([userId, totalAmount]) => ({
                      userId,
                      username: usernames[userId] || `User-${userId.slice(0, 4)}`,
                      totalSpending: Number(totalAmount.toFixed(2)), // Store actual amount
                      isFriend: friends.includes(userId),
                      isCurrentUser: userId === user.uid
                    }))
                    .sort((a, b) => b.totalSpending - a.totalSpending)
                    .slice(0, 10); // Top 10 users
                } else {
                  // For other categories, use percentages
                  categoryLeaderboards[category] = Object.entries(userData)
                    .map(([userId, percentage]) => ({
                      userId,
                      username: usernames[userId] || `User-${userId.slice(0, 4)}`,
                      totalSpending: Number(percentage.toFixed(2)), // Store percentage
                      isFriend: friends.includes(userId),
                      isCurrentUser: userId === user.uid
                    }))
                    .sort((a, b) => b.totalSpending - a.totalSpending)
                    .slice(0, 10); // Top 10 users
                }
              });

              setCategoryStats(categoryLeaderboards);
              
              debug.steps.push({
                step: 'Category processing',
                success: true,
                categories: Object.keys(categoryLeaderboards)
              });
              setDebugInfo(debug);
            } catch (error) {
              console.error('Error processing transactions:', error);
              debug.steps.push({
                step: 'Transactions processing',
                success: false,
                error: error.message
              });
              setDebugInfo(debug);
            }
          },
          (error) => {
            console.error('Error in transactions listener:', error);
            setDebugInfo(prev => ({
              ...prev,
              transactionsError: error.message
            }));
          }
        );
      } catch (error) {
        console.error('Error setting up real-time updates:', error);
        if (error.message === 'User not authenticated') {
          navigate('/login');
        } else {
          setError('Failed to initialize leaderboard');
          setDebugInfo({
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
          });
        }
        setLoading(false);
      }
    };

    // Set up auth state listener
    unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        setupRealTimeUpdates();
      } else {
        navigate('/login');
      }
    });

    // Cleanup function to unsubscribe from all listeners
    return () => {
      if (unsubscribeStats) unsubscribeStats();
      if (unsubscribeUser) unsubscribeUser();
      if (unsubscribeAuth) unsubscribeAuth();
      if (unsubscribeTransactions) unsubscribeTransactions();
    };
  }, [navigate, DEFAULT_CATEGORIES]);

  const getRankStyle = (index) => {
    switch (index) {
      case 0: return 'rank-1';
      case 1: return 'rank-2';
      case 2: return 'rank-3';
      default: return '';
    }
  };

  const formatDate = (date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getCategoryIcon = (category) => {
    const icons = {
      'All': '📊',
      'Housing': '🏠',
      'Transportation': '🚗',
      'Food': '🍔',
      'Utilities': '💡',
      'Entertainment': '🎬',
      'Savings': '💰',
      'Personal': '👤',
      'Other': '📦'
    };
    return icons[category] || '📊';
  };

  // Add this function to navigate to category chat
  const handleCategoryChat = (category, e) => {
    e.stopPropagation(); // Prevent triggering the card click
    navigate(`/chat/category/${category.toLowerCase()}`);
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner"></div>
        <p>Loading leaderboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h3>Error Loading Leaderboard</h3>
        <p>{error}</p>
        <div className="error-actions">
          <button onClick={() => window.location.reload()}>
            Try Again
          </button>
          <button onClick={() => setShowDebug(!showDebug)} className="debug-button">
            {showDebug ? 'Hide Debug Info' : 'Show Debug Info'}
          </button>
        </div>
        {showDebug && debugInfo && (
          <div className="debug-info">
            <h4>Debug Information</h4>
            <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  }

  const displayStats = showOnlyFriends 
    ? stats.filter(stat => stat.isFriend || stat.isCurrentUser)
    : stats;

  // Get category-specific stats
  const displayCategoryStats = categoryStats[selectedCategory] || [];
  const filteredCategoryStats = showOnlyFriends
    ? displayCategoryStats.filter(stat => stat.isFriend || stat.isCurrentUser)
    : displayCategoryStats;

  return (
    <div className="all-stats-container">
      <h1>Spending Leaderboard</h1>
      
      <div className="leaderboard-controls">
        <button 
          className={`filter-button ${showOnlyFriends ? 'active' : ''}`}
          onClick={() => setShowOnlyFriends(!showOnlyFriends)}
        >
          {showOnlyFriends ? 'Show All Users' : 'Show Friends Only'}
        </button>
        {showDebug && debugInfo && (
          <div className="debug-info">
            <h4>Debug Information</h4>
            <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Category selector */}
      <div className="category-selector">
        <h3>Select Category</h3>
        <div className="category-buttons">
          {['All', ...DEFAULT_CATEGORIES].map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`category-button ${selectedCategory === category ? 'active' : ''}`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="leaderboard-table-container">
        <h2 className="category-heading">
          {selectedCategory === 'All' ? 'Friends Total Spending' : `${selectedCategory} Spending Percentage`}
        </h2>
        {filteredCategoryStats.length > 0 ? (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>{selectedCategory === 'All' ? 'Friend' : 'Username'}</th>
                <th>{selectedCategory === 'All' ? 'Total Spending' : 'Percentage'}</th>
                {selectedCategory === 'All' && <th>Last Updated</th>}
              </tr>
            </thead>
            <tbody>
              {filteredCategoryStats.map((stat, index) => (
                <tr 
                  key={stat.userId} 
                  className={`${getRankStyle(index)} ${stat.isFriend ? 'friend-row' : ''} ${stat.isCurrentUser ? 'current-user-row' : ''}`}
                >
                  <td>
                    {index + 1}
                    {index < 3 && <span className="rank-emoji">{['🥇', '🥈', '🥉'][index]}</span>}
                  </td>
                  <td>
                    <span className={`leaderboard-username ${stat.isFriend ? 'friend' : ''} ${stat.isCurrentUser ? 'current-user' : ''}`}>
                      {stat.username}
                    </span>
                    {stat.isFriend && <span className="user-badge friend">Friend</span>}
                    {stat.isCurrentUser && <span className="user-badge you">You</span>}
                  </td>
                  <td>
                    {selectedCategory === 'All' 
                      ? formatCurrency(stat.totalSpending)
                      : `${stat.totalSpending}%`
                    }
                  </td>
                  {selectedCategory === 'All' && stat.lastUpdated && <td>{formatDate(stat.lastUpdated)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="no-stats-message">
            {selectedCategory === 'All' 
              ? (friends.length === 0 
                  ? "Add some friends to see their spending patterns!"
                  : "No spending data available for friends yet.")
              : `No ${selectedCategory.toLowerCase()} spending data available yet.`}
          </div>
        )}
      </div>

      {/* Desktop view - show all categories in a grid */}
      <div className="category-leaderboards-grid">
        <h2 className="section-heading">Category Leaderboards</h2>
        <div className="leaderboards-grid">
          {['All', ...DEFAULT_CATEGORIES].map(category => (
            <div 
              key={category} 
              className={`leaderboard-card ${selectedCategory === category ? 'selected-category' : ''}`}
              onClick={() => setSelectedCategory(category)}
            >
              <div className="category-icon">
                {getCategoryIcon(category)}
              </div>
              <h3>{category} Spending Leaders</h3>
              <button 
                className="category-chat-btn"
                onClick={(e) => handleCategoryChat(category, e)}
              >
                💬 Join Category Chat
              </button>
              {categoryStats[category]?.length > 0 ? (
                <div className="mini-leaderboard">
                  {categoryStats[category]
                    .slice(0, 3)
                    .map((stat, index) => (
                      <div 
                        key={stat.userId} 
                        className={`mini-leaderboard-item rank-${index + 1} ${stat.isFriend ? 'friend-item' : ''} ${stat.isCurrentUser ? 'current-user-item' : ''}`}
                      >
                        <span className="rank">{index + 1}</span>
                        <span className={`mini-leaderboard-username ${stat.isFriend ? 'friend' : ''} ${stat.isCurrentUser ? 'current-user' : ''}`}>
                          {stat.username}
                          {stat.isCurrentUser && <span className="user-badge you">You</span>}
                        </span>
                        <span className="mini-leaderboard-amount">
                          {category === 'All'
                            ? formatCurrency(stat.totalSpending)
                            : `${stat.totalSpending}%`
                          }
                        </span>
                      </div>
                    ))}
                  <button 
                    className="view-more-button"
                    onClick={() => setSelectedCategory(category)}
                  >
                    View More
                  </button>
                </div>
              ) : (
                <div className="empty-leaderboard">
                  <p>No data available</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AllStats;
