import React, { useEffect, useState, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { db, auth } from "./firebase-config";
import { collection, query, where, getDocs, Timestamp, doc, getDoc, updateDoc, arrayUnion, increment } from "firebase/firestore";
import "./App.css";
import { useNavigate } from "react-router-dom";

const MyStats = () => {
  const [userData, setUserData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [comparisonData, setComparisonData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [financialInsights, setFinancialInsights] = useState(null);
  const [userGoals, setUserGoals] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [newSavingAmount, setNewSavingAmount] = useState('');
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [reachedMilestone, setReachedMilestone] = useState(null);
  const confettiRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          setError("You must be logged in to view your stats.");
          setLoading(false);
          return;
        }

        const userId = user.uid;
        
        // Get transactions from the last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Query for user's transactions
        const userTransactionsQuery = query(
          collection(db, "transactions"),
          where("userId", "==", userId),
          where("timestamp", ">=", Timestamp.fromDate(thirtyDaysAgo))
        );
        
        // Query for all transactions (to calculate average)
        const allTransactionsQuery = query(
          collection(db, "transactions"),
          where("timestamp", ">=", Timestamp.fromDate(thirtyDaysAgo))
        );
        
        // Get user's financial goals if they exist
        const userGoalsRef = doc(db, "goals", userId);
        
        const [userTransactionsSnapshot, allTransactionsSnapshot, userGoalsSnapshot] = await Promise.all([
          getDocs(userTransactionsQuery),
          getDocs(allTransactionsQuery),
          getDoc(userGoalsRef)
        ]);

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

        if (userTransactionsSnapshot.empty) {
          setError("No transactions found in the last 30 days. Add transactions to see your stats!");
          setLoading(false);
          return;
        }

        // Process user's transactions for category pie chart
        const categorySpending = {};
        const userDailySpending = {};
        let totalUserSpending = 0;
        
        userTransactionsSnapshot.docs.forEach((doc) => {
          const transaction = doc.data();
          
          // Format the date
          const date = transaction.timestamp.toDate();
          const dateStr = date.toLocaleDateString();
          
          // Add to daily spending
          if (!userDailySpending[dateStr]) {
            userDailySpending[dateStr] = 0;
          }
          userDailySpending[dateStr] += Number(transaction.amount);
          totalUserSpending += Number(transaction.amount);
          
          // Add to category spending
          const category = transaction.category || "Other";
          if (!categorySpending[category]) {
            categorySpending[category] = 0;
          }
          categorySpending[category] += Number(transaction.amount);
        });
        
        // Process all transactions for average spending calculation
        const allUsersDailySpending = {};
        const userCountByDay = {};
        let totalAverageSpending = 0;
        let totalUsers = 0;
        
        allTransactionsSnapshot.docs.forEach((doc) => {
          const transaction = doc.data();
          const date = transaction.timestamp.toDate();
          const dateStr = date.toLocaleDateString();
          
          if (!allUsersDailySpending[dateStr]) {
            allUsersDailySpending[dateStr] = 0;
            userCountByDay[dateStr] = new Set();
          }
          
          allUsersDailySpending[dateStr] += Number(transaction.amount);
          userCountByDay[dateStr].add(transaction.userId);
        });
        
        // Calculate average spending per day
        const avgDailySpending = {};
        Object.keys(allUsersDailySpending).forEach(date => {
          const userCount = userCountByDay[date].size;
          avgDailySpending[date] = userCount > 0 ? allUsersDailySpending[date] / userCount : 0;
          totalAverageSpending += avgDailySpending[date];
          if (userCount > totalUsers) totalUsers = userCount;
        });
        
        // Create comparison data array - include ALL days with average spending
        const comparisonArray = Object.keys(avgDailySpending)
          .map(date => ({
            date,
            yourSpending: userDailySpending[date] || 0,
            avgSpending: avgDailySpending[date] || 0,
            // Flag to indicate if user has spending on this day
            hasUserData: userDailySpending[date] !== undefined
          }))
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Convert category spending to array for pie chart
        const categorySpendingArray = Object.entries(categorySpending)
          .map(([name, value]) => ({ name, value }));
        
        // Generate financial insights based on spending patterns
        const insights = generateFinancialInsights(
          totalUserSpending, 
          totalAverageSpending, 
          categorySpending, 
          userDailySpending, 
          avgDailySpending,
          Object.keys(avgDailySpending).length
        );
        
        setFinancialInsights(insights);
        setComparisonData(comparisonArray);
        setCategoryData(categorySpendingArray);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        setError("Failed to fetch transactions. Please try again later.");
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Function to generate personalized financial insights
  const generateFinancialInsights = (
    totalUserSpending, 
    totalAverageSpending, 
    categorySpending, 
    userDailySpending, 
    avgDailySpending,
    daysCount
  ) => {
    const insights = {
      summary: "",
      tips: [],
      categoryInsights: []
    };
    
    // Compare total spending with average
    const avgTotalSpending = totalAverageSpending / daysCount;
    const userAverageDailySpending = totalUserSpending / Object.keys(userDailySpending).length;
    
    if (userAverageDailySpending > avgTotalSpending * 1.2) {
      insights.summary = "You're spending more than the average user. Let's find ways to reduce expenses.";
    } else if (userAverageDailySpending < avgTotalSpending * 0.8) {
      insights.summary = "Great job! You're spending less than the average user. Keep it up!";
    } else {
      insights.summary = "Your spending is on par with the average user.";
    }
    
    // Analyze spending by category
    Object.entries(categorySpending).forEach(([category, amount]) => {
      const categoryPercent = (amount / totalUserSpending) * 100;
      
      if (categoryPercent > 30 && category !== "Housing") {
        insights.categoryInsights.push({
          category,
          message: `Your ${category} spending is ${categoryPercent.toFixed(0)}% of your total budget. Consider reducing expenses in this category.`,
          actionable: true,
          type: "warning"
        });
      }
      
      if (category === "Food" && categoryPercent > 20) {
        insights.tips.push("Try meal planning to reduce food expenses.");
      }
      
      if (category === "Entertainment" && categoryPercent > 15) {
        insights.tips.push("Look for free or low-cost entertainment options to reduce spending.");
      }
    });
    
    // Analyze spending patterns
    const spendingDates = Object.keys(userDailySpending).map(date => new Date(date));
    spendingDates.sort((a, b) => a - b);
    
    if (spendingDates.length > 0) {
      const weekdaySpending = {};
      let weekendTotal = 0;
      let weekdayTotal = 0;
      let weekendCount = 0;
      let weekdayCount = 0;
      
      spendingDates.forEach(date => {
        const day = date.getDay();
        const isWeekend = day === 0 || day === 6; // 0 is Sunday, 6 is Saturday
        const dateStr = date.toLocaleDateString();
        
        if (isWeekend) {
          weekendTotal += userDailySpending[dateStr];
          weekendCount++;
        } else {
          weekdayTotal += userDailySpending[dateStr];
          weekdayCount++;
          
          if (!weekdaySpending[day]) {
            weekdaySpending[day] = 0;
          }
          weekdaySpending[day] += userDailySpending[dateStr];
        }
      });
      
      const avgWeekend = weekendCount > 0 ? weekendTotal / weekendCount : 0;
      const avgWeekday = weekdayCount > 0 ? weekdayTotal / weekdayCount : 0;
      
      if (avgWeekend > avgWeekday * 1.5) {
        insights.tips.push("Your weekend spending is significantly higher than weekdays. Consider setting a weekend budget to control expenses.");
      }
      
      // Find highest spending weekday
      let highestDay = 0;
      let highestAmount = 0;
      
      Object.entries(weekdaySpending).forEach(([day, amount]) => {
        const avgAmount = amount / (Math.floor(weekdayCount / 5) || 1); // Approximate occurrence count for this weekday
        if (avgAmount > highestAmount) {
          highestDay = parseInt(day);
          highestAmount = avgAmount;
        }
      });
      
      if (highestAmount > avgWeekday * 1.3) {
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        insights.tips.push(`You tend to spend more on ${dayNames[highestDay]}s. Be mindful of your spending habits on this day.`);
      }
    }
    
    return insights;
  };

  // Function to add a new saving to a goal
  const addSavingToGoal = async (goalId, amount) => {
    try {
      if (!amount || isNaN(amount) || amount <= 0) {
        alert("Please enter a valid amount");
        return;
      }

      const user = auth.currentUser;
      if (!user) return;

      const parsedAmount = parseFloat(amount);
      const goalIndex = userGoals.findIndex(g => g.id === goalId);
      
      if (goalIndex === -1) return;
      
      const goal = userGoals[goalIndex];
      const newAmount = goal.currentAmount + parsedAmount;
      const previousMilestones = goal.milestones ? goal.milestones.filter(m => m.amount <= goal.currentAmount) : [];
      
      // Check for new milestones reached
      let newMilestoneReached = null;
      if (goal.milestones) {
        for (const milestone of goal.milestones) {
          if (milestone.amount > goal.currentAmount && milestone.amount <= newAmount) {
            newMilestoneReached = milestone;
            break;
          }
        }
      }
      
      // Update the goal in Firestore
      const userGoalsRef = doc(db, "goals", user.uid);
      await updateDoc(userGoalsRef, {
        [`goals.${goalIndex}.currentAmount`]: newAmount,
        [`goals.${goalIndex}.lastContribution`]: {
          amount: parsedAmount,
          date: new Date()
        },
        // Add to contribution history
        [`goals.${goalIndex}.contributionHistory`]: arrayUnion({
          amount: parsedAmount,
          date: new Date(),
          milestoneReached: newMilestoneReached ? newMilestoneReached.name : null
        })
      });
      
      // Update local state
      const updatedGoals = [...userGoals];
      updatedGoals[goalIndex] = {
        ...goal,
        currentAmount: newAmount,
        progressPercent: Math.min((newAmount / goal.targetAmount) * 100, 100),
        lastContribution: {
          amount: parsedAmount,
          date: new Date()
        }
      };
      
      setUserGoals(updatedGoals);
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
      
    } catch (error) {
      console.error("Error adding saving to goal:", error);
      alert("Failed to update goal. Please try again.");
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

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#19e6ff", "#8884d8", "#ff4488"];

  if (loading) {
    return <div className="loading">Loading your stats...</div>;
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <button onClick={() => navigate("/add-transaction")} className="primary-button">
          Add Transaction
        </button>
      </div>
    );
  }

  return (
    <div className="mystats-container">
      <h1>Your Spending Stats</h1>
      
      {financialInsights && (
        <div className="dashboard-section coaching-section">
          <h2>Personalized Financial Coaching</h2>
          <div className="insight-summary">
            <div className="insight-icon">💡</div>
            <p className="insight-text">{financialInsights.summary}</p>
          </div>
          
          {financialInsights.tips.length > 0 && (
            <div className="coaching-tips">
              <h3>Recommended Actions</h3>
              <ul className="tips-list">
                {financialInsights.tips.map((tip, index) => (
                  <li key={index} className="tip-item">
                    <span className="tip-icon">✓</span>
                    <span className="tip-text">{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {financialInsights.categoryInsights.length > 0 && (
            <div className="category-insights">
              <h3>Category Insights</h3>
              {financialInsights.categoryInsights.map((insight, index) => (
                <div 
                  key={index} 
                  className={`insight-card ${insight.type}`}
                >
                  <div className="insight-card-header">
                    <h4>{insight.category}</h4>
                    {insight.type === "warning" && <span className="warning-icon">⚠️</span>}
                  </div>
                  <p>{insight.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {userGoals.length > 0 && (
        <div className="dashboard-section">
          <h2>Financial Goals Progress</h2>
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
        </div>
      )}
      
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
      
      <div className="dashboard-section">
        <h2>Your Spending vs. Average User (Last 30 Days)</h2>
        {comparisonData.length > 0 ? (
      <ResponsiveContainer width="100%" height={400}>
            <LineChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3d42" />
              <XAxis 
                dataKey="date" 
                tick={{ fill: '#e0e0e0' }}
                axisLine={{ stroke: '#3a3d42' }}
              />
              <YAxis 
                tick={{ fill: '#e0e0e0' }}
                axisLine={{ stroke: '#3a3d42' }}
                label={{ value: 'Amount (£)', angle: -90, position: 'insideLeft', fill: '#e0e0e0' }}
              />
              <Tooltip 
                formatter={(value, name) => {
                  if (name === "yourSpending") {
                    return [`£${value.toFixed(2)}`, 'Your Spending'];
                  } else if (name === "avgSpending") {
                    return [`£${value.toFixed(2)}`, 'Average User Spending'];
                  }
                  return [`£${value.toFixed(2)}`, name];
                }}
                labelFormatter={(dateStr) => {
                  try {
                    // Format the date to be more readable
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('en-GB', { 
                      weekday: 'short',
                      day: 'numeric', 
                      month: 'short'
                    });
                  } catch (error) {
                    return dateStr;
                  }
                }}
                contentStyle={{
                  backgroundColor: '#23262b',
                  border: '1px solid #19e6ff',
                  borderRadius: '8px',
                  color: '#fff',
                  padding: '10px 14px'
                }}
              />
          <Legend />
              <Line 
                type="monotone" 
                dataKey="yourSpending" 
                stroke="#19e6ff" 
                strokeWidth={3} 
                dot={({ hasUserData }) => hasUserData ? { fill: '#19e6ff', r: 5 } : false}
                activeDot={({ hasUserData }) => hasUserData ? { r: 8 } : false}
                name="Your Spending" 
              />
              <Line 
                type="monotone" 
                dataKey="avgSpending" 
                stroke="#FF8042" 
                strokeWidth={3} 
                dot={{ fill: '#FF8042', r: 5 }} 
                activeDot={{ r: 8 }}
                name="Average User Spending" 
              />
        </LineChart>
      </ResponsiveContainer>
        ) : (
          <div className="empty-chart">
            <p>No comparison data available. Please add transactions first!</p>
            <button onClick={() => navigate("/add-transaction")} className="primary-button">
              Add Transaction
            </button>
          </div>
        )}
        <div className="chart-note">
          <p>This chart shows how your daily spending compares to the average spending of all users.</p>
        </div>
      </div>
      
      <div className="dashboard-section">
        <h2>Spending by Category</h2>
        {categoryData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
        <PieChart>
              <Pie 
                data={categoryData} 
                dataKey="value" 
                nameKey="name" 
                cx="50%" 
                cy="50%" 
                outerRadius={150}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {categoryData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
              <Tooltip 
                formatter={(value) => `£${value.toFixed(2)}`}
                contentStyle={{
                  backgroundColor: '#23262b',
                  border: '1px solid #19e6ff',
                  borderRadius: '8px',
                  color: '#fff'
                }}
              />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
        ) : (
          <div className="empty-chart">
            <p>No category data available yet.</p>
          </div>
        )}
      </div>
      
      <div className="stats-actions">
        <button onClick={() => navigate("/add-transaction")} className="primary-button">
          Add Transaction
        </button>
        <button onClick={() => navigate("/dashboard")} className="secondary-button">
          Back to Dashboard
      </button>
      </div>
      
      <style jsx>{`
        .mystats-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        
        .dashboard-section {
          background: #23262b;
          border-radius: 16px;
          padding: 32px 24px 24px 24px;
          margin-bottom: 32px;
          box-shadow: 0 2px 16px 0 rgba(0,0,0,0.12);
        }
        
        h1, h2, h3, h4 {
          color: #19e6ff;
          font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
          margin-bottom: 20px;
        }
        
        h1 {
          font-size: 2.5rem;
          text-align: center;
          margin-bottom: 30px;
        }
        
        h2 {
          font-size: 1.8rem;
          margin-bottom: 20px;
        }
        
        h3 {
          font-size: 1.4rem;
          margin-bottom: 15px;
          color: #e0e0e0;
        }
        
        h4 {
          font-size: 1.2rem;
          margin-bottom: 10px;
          color: #ffffff;
        }
        
        .empty-chart {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 50px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          text-align: center;
        }
        
        .empty-chart p {
          color: #e0e0e0;
          margin-bottom: 20px;
          font-size: 1.1rem;
        }
        
        .chart-note {
          margin-top: 15px;
          text-align: center;
          color: #e0e0e0;
          font-style: italic;
          font-size: 0.9rem;
        }
        
        .stats-actions {
          display: flex;
          gap: 16px;
          justify-content: center;
          margin-top: 20px;
        }
        
        .primary-button, .secondary-button {
          padding: 12px 24px;
          border-radius: 30px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          border: none;
        }
        
        .primary-button {
          background: linear-gradient(135deg, #19e6ff 0%, #0ef 100%);
          color: #23262b;
        }
        
        .secondary-button {
          background: rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
          border: 1px solid #19e6ff;
        }
        
        .primary-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 238, 255, 0.3);
        }
        
        .secondary-button:hover {
          background: rgba(25, 230, 255, 0.1);
        }
        
        .loading {
          text-align: center;
          color: #19e6ff;
          font-size: 1.5rem;
          padding: 100px 0;
        }
        
        .error-container {
          text-align: center;
          padding: 100px 0;
        }
        
        .error-message {
          color: #ff6b6b;
          font-size: 1.2rem;
          margin-bottom: 20px;
        }
        
        /* Coaching Section Styles */
        .coaching-section {
          background: linear-gradient(135deg, #23262b 0%, #2a2f3a 100%);
        }
        
        .insight-summary {
          display: flex;
          align-items: center;
          background: rgba(25, 230, 255, 0.1);
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 24px;
        }
        
        .insight-icon {
          font-size: 2rem;
          margin-right: 15px;
        }
        
        .insight-text {
          color: #ffffff;
          font-size: 1.2rem;
          line-height: 1.5;
        }
        
        .coaching-tips {
          background: rgba(255, 255, 255, 0.05);
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 24px;
        }
        
        .tips-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        
        .tip-item {
          display: flex;
          align-items: center;
          margin-bottom: 15px;
          color: #e0e0e0;
        }
        
        .tip-icon {
          color: #00C49F;
          font-size: 1.2rem;
          font-weight: bold;
          margin-right: 12px;
        }
        
        .tip-text {
          font-size: 1rem;
          line-height: 1.5;
        }
        
        .category-insights {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        
        .insight-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 16px;
          transition: transform 0.3s;
        }
        
        .insight-card:hover {
          transform: translateY(-5px);
        }
        
        .insight-card.warning {
          border-left: 4px solid #FF8042;
        }
        
        .insight-card.success {
          border-left: 4px solid #00C49F;
        }
        
        .insight-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        
        .warning-icon {
          font-size: 1.2rem;
        }
        
        .insight-card p {
          color: #e0e0e0;
          line-height: 1.5;
          margin: 0;
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
        
        /* Modal styles */
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
      `}</style>
    </div>
  );
};

export default MyStats;
