import React, { useState, useEffect, useRef } from "react";
import { db, auth } from "./firebase-config";
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, arrayUnion, Timestamp, deleteDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./App.css";

const Goals = () => {
  const navigate = useNavigate();
  const [userGoals, setUserGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGoal, setNewGoal] = useState({
    name: "",
    targetAmount: "",
    currentAmount: 0,
    targetDate: "",
    description: ""
  });

  useEffect(() => {
    const fetchGoals = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          setError("You must be logged in to view your goals.");
          setLoading(false);
          return;
        }

        const userGoalsRef = doc(db, "goals", user.uid);
        const userGoalsSnapshot = await getDoc(userGoalsRef);
        
        // Process goals data if it exists
        const goalsData = [];
        if (userGoalsSnapshot.exists()) {
          const goals = userGoalsSnapshot.data().goals || [];
          goals.forEach(goal => {
            if (goal.targetAmount) {
              const progressPercent = (goal.currentAmount / goal.targetAmount) * 100;
              goalsData.push({
                ...goal,
                progressPercent: Math.min(progressPercent, 100)
              });
            }
          });
        }
        setUserGoals(goalsData);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching goals:", error);
        setError("Failed to fetch goals. Please try again.");
        setLoading(false);
      }
    };

    fetchGoals();
  }, []);

  // Generate default milestones for new goals
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

  const handleCreateGoal = async () => {
    try {
      if (!newGoal.name || !newGoal.targetAmount) {
        alert("Please fill in all required fields");
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        setError("You must be logged in to create a goal.");
        navigate('/login');
        return;
      }

      const targetAmount = parseFloat(newGoal.targetAmount);
      if (isNaN(targetAmount) || targetAmount <= 0) {
        alert("Please enter a valid target amount");
        return;
      }

      console.log("Creating goal:", newGoal.name);
      console.log("User ID:", user.uid);

      // Create a new goal object
      const goalToAdd = {
        id: `goal_${Date.now()}`,
        name: newGoal.name,
        targetAmount,
        currentAmount: 0,
        description: newGoal.description || "",
        targetDate: newGoal.targetDate ? new Date(newGoal.targetDate) : null,
        createdAt: Timestamp.fromDate(new Date()),
        lastContribution: null,
        contributionHistory: [],
        milestones: generateDefaultMilestones(targetAmount)
      };

      // Reference to the user's goals document
      const userGoalsRef = doc(db, "goals", user.uid);
      console.log("Writing to document path:", userGoalsRef.path);
      
      const userGoalsSnapshot = await getDoc(userGoalsRef);
      console.log("Document exists:", userGoalsSnapshot.exists());

      if (userGoalsSnapshot.exists()) {
        // Get current goals array
        const currentGoals = userGoalsSnapshot.data().goals || [];
        console.log("Current goals count:", currentGoals.length);
        
        // Add the new goal to the array
        const updatedGoals = [...currentGoals, goalToAdd];
        
        // Update with the entire array
        await updateDoc(userGoalsRef, {
          goals: updatedGoals
        });
        console.log("Goal added to existing document");
      } else {
        // Create new goals document
        await setDoc(userGoalsRef, {
          goals: [goalToAdd],
          userId: user.uid
        });
        console.log("New goals document created with first goal");
      }

      // Update local state
      const progressPercent = 0; // New goal starts at 0%
      setUserGoals(prev => [...prev, { ...goalToAdd, progressPercent }]);
      setShowAddModal(false);
      setNewGoal({
        name: "",
        targetAmount: "",
        currentAmount: 0,
        targetDate: "",
        description: ""
      });
      
      alert("Goal created successfully!");
    } catch (error) {
      console.error("Error creating goal:", error);
      let errorMessage = "Failed to create goal. ";
      
      if (error.code === 'permission-denied') {
        errorMessage += "You don't have permission to create goals.";
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

  const handleDeleteGoal = async (goalId) => {
    if (!window.confirm("Are you sure you want to delete this goal?")) {
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) {
        setError("You must be logged in to delete a goal.");
        navigate('/login');
        return;
      }

      console.log("Deleting goal:", goalId);
      console.log("User ID:", user.uid);

      const userGoalsRef = doc(db, "goals", user.uid);
      const userGoalsSnapshot = await getDoc(userGoalsRef);
      
      if (userGoalsSnapshot.exists()) {
        const goals = userGoalsSnapshot.data().goals || [];
        console.log("Current goals count:", goals.length);
        
        const goalExists = goals.some(goal => goal.id === goalId);
        if (!goalExists) {
          alert("This goal doesn't exist or has already been deleted.");
          // Update local state to remove the goal if it's still in the state
          setUserGoals(prev => prev.filter(goal => goal.id !== goalId));
          return;
        }
        
        const updatedGoals = goals.filter(goal => goal.id !== goalId);
        console.log("Updated goals count:", updatedGoals.length);
        
        // Update with the entire array
        await updateDoc(userGoalsRef, {
          goals: updatedGoals
        });
        
        // Update local state
        setUserGoals(prev => prev.filter(goal => goal.id !== goalId));
        alert("Goal deleted successfully!");
      } else {
        alert("No goals found for your account.");
      }
    } catch (error) {
      console.error("Error deleting goal:", error);
      let errorMessage = "Failed to delete goal. ";
      
      if (error.code === 'permission-denied') {
        errorMessage += "You don't have permission to delete this goal.";
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

  const renderAddGoalModal = () => {
    if (!showAddModal) return null;

    return (
      <div className="modal-overlay">
        <div className="goal-modal">
          <h3>Create New Financial Goal</h3>
          <div className="goal-form">
            <div className="form-group">
              <label>Goal Name*</label>
              <input
                type="text"
                value={newGoal.name}
                onChange={(e) => setNewGoal({...newGoal, name: e.target.value})}
                placeholder="E.g., New Car, Emergency Fund, Vacation"
              />
            </div>
            <div className="form-group">
              <label>Target Amount (£)*</label>
              <input
                type="number"
                value={newGoal.targetAmount}
                onChange={(e) => setNewGoal({...newGoal, targetAmount: e.target.value})}
                placeholder="Enter amount"
                min="0.01"
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label>Target Date (Optional)</label>
              <input
                type="date"
                value={newGoal.targetDate}
                onChange={(e) => setNewGoal({...newGoal, targetDate: e.target.value})}
              />
            </div>
            <div className="form-group">
              <label>Description (Optional)</label>
              <textarea
                value={newGoal.description}
                onChange={(e) => setNewGoal({...newGoal, description: e.target.value})}
                placeholder="Why is this goal important to you?"
                rows="3"
              />
            </div>
          </div>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setShowAddModal(false);
                setNewGoal({
                  name: "",
                  targetAmount: "",
                  currentAmount: 0,
                  targetDate: "",
                  description: ""
                });
              }}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={handleCreateGoal}
              disabled={!newGoal.name || !newGoal.targetAmount}
            >
              Create Goal
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="loading">Loading your goals...</div>;
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <button onClick={() => navigate("/dashboard")} className="primary-button">
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="goals-page">
      <div className="goals-header">
        <h1>Financial Goals</h1>
        <button
          className="add-goal-button"
          onClick={() => setShowAddModal(true)}
        >
          + Create New Goal
        </button>
      </div>

      {userGoals.length > 0 ? (
        <div className="goals-container">
          {userGoals.map((goal, index) => (
            <div key={index} className="goal-card">
              <div className="goal-card-header">
                <h3 className="goal-title">{goal.name}</h3>
                <button 
                  className="delete-goal-button" 
                  onClick={() => handleDeleteGoal(goal.id)}
                >
                  ×
                </button>
              </div>
              {goal.description && (
                <p className="goal-description">{goal.description}</p>
              )}
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
              <div className="add-saving-button-container">
                <button 
                  className="add-saving-button" 
                  onClick={() => {
                    // Navigate to dashboard with goal ID as parameter
                    navigate(`/dashboard?goalId=${goal.id}`);
                  }}
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
      ) : (
        <div className="empty-goals">
          <p>You haven't created any financial goals yet.</p>
          <p>Goals help you track your savings progress and celebrate milestones!</p>
          <button
            className="large-add-goal-button"
            onClick={() => setShowAddModal(true)}
          >
            Create Your First Goal
          </button>
        </div>
      )}

      {renderAddGoalModal()}

      <style jsx>{`
        .goals-page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        
        .goals-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 40px;
        }
        
        .goals-header h1 {
          color: #19e6ff;
          font-size: 2.5rem;
          margin: 0;
        }
        
        .add-goal-button {
          background: linear-gradient(135deg, #19e6ff 0%, #0ef 100%);
          color: #23262b;
          border: none;
          border-radius: 30px;
          padding: 12px 24px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .add-goal-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 238, 255, 0.3);
        }
        
        .goals-container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 30px;
          margin-bottom: 40px;
        }
        
        .goal-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 24px;
          transition: transform 0.3s;
          position: relative;
        }
        
        .goal-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15);
        }
        
        .goal-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px;
        }
        
        .goal-title {
          font-size: 1.4rem;
          color: #ffffff;
          margin: 0;
        }
        
        .delete-goal-button {
          background: rgba(255, 100, 100, 0.2);
          color: #ff6464;
          border: none;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          font-size: 1.4rem;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s;
          padding: 0;
          line-height: 1;
        }
        
        .delete-goal-button:hover {
          background: rgba(255, 100, 100, 0.4);
        }
        
        .goal-description {
          color: #a0a0a0;
          font-size: 0.9rem;
          margin-bottom: 20px;
          font-style: italic;
        }
        
        .goal-amounts {
          display: flex;
          align-items: baseline;
          margin-bottom: 12px;
        }
        
        .current-amount {
          font-size: 1.6rem;
          font-weight: 600;
          color: #19e6ff;
          margin-right: 5px;
        }
        
        .target-amount {
          color: #a0a0a0;
          font-size: 1.1rem;
        }
        
        .progress-bar-container {
          height: 12px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        
        .progress-bar {
          height: 100%;
          background: linear-gradient(to right, #0088FE, #19e6ff);
          border-radius: 6px;
          transition: width 1s ease-in-out;
        }
        
        .progress-percentage {
          color: #e0e0e0;
          font-size: 1rem;
          margin-bottom: 12px;
        }
        
        .goal-date {
          color: #a0a0a0;
          font-size: 0.9rem;
          font-style: italic;
          margin-bottom: 20px;
        }
        
        .milestones-preview {
          position: relative;
          height: 24px;
          margin: 10px 0 24px;
        }
        
        .milestone-dot {
          position: absolute;
          width: 18px;
          height: 18px;
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
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          background: #23262b;
          color: white;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 13px;
          white-space: nowrap;
          z-index: 10;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .add-saving-button-container {
          margin: 20px 0;
          text-align: center;
        }
        
        .add-saving-button {
          background: rgba(0, 196, 159, 0.2);
          color: #00C49F;
          border: 1px solid #00C49F;
          border-radius: 24px;
          padding: 10px 20px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
          width: 100%;
        }
        
        .add-saving-button:hover {
          background: rgba(0, 196, 159, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 196, 159, 0.2);
        }
        
        .last-contribution {
          font-size: 0.9rem;
          color: #a0a0a0;
          margin-top: 15px;
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
        
        .empty-goals {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 60px 30px;
          text-align: center;
        }
        
        .empty-goals p {
          color: #e0e0e0;
          margin-bottom: 10px;
          font-size: 1.2rem;
        }
        
        .empty-goals p:last-of-type {
          margin-bottom: 30px;
          color: #a0a0a0;
          font-size: 1.1rem;
        }
        
        .large-add-goal-button {
          background: linear-gradient(135deg, #19e6ff 0%, #0ef 100%);
          color: #23262b;
          border: none;
          border-radius: 30px;
          padding: 16px 32px;
          font-size: 1.2rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .large-add-goal-button:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 20px rgba(0, 238, 255, 0.3);
        }
        
        /* Modal styles */
        .modal-overlay {
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
        
        .goal-modal {
          background: #2a2f3a;
          border-radius: 16px;
          width: 90%;
          max-width: 600px;
          padding: 30px;
          box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
        }
        
        .goal-modal h3 {
          color: #19e6ff;
          text-align: center;
          font-size: 1.8rem;
          margin-bottom: 25px;
        }
        
        .goal-form {
          margin-bottom: 30px;
        }
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 10px;
          font-size: 1.1rem;
          color: #e0e0e0;
        }
        
        .form-group input,
        .form-group textarea {
          width: 100%;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 10px;
          padding: 15px;
          font-size: 1.1rem;
          color: white;
          transition: all 0.3s;
        }
        
        .form-group input:focus,
        .form-group textarea:focus {
          border-color: #19e6ff;
          outline: none;
          box-shadow: 0 0 0 3px rgba(25, 230, 255, 0.2);
        }
        
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 15px;
        }
        
        .primary-button,
        .secondary-button {
          padding: 12px 30px;
          border-radius: 30px;
          font-size: 1.1rem;
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
        
        .primary-button:disabled {
          background: #ccc;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        
        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          color: #19e6ff;
          font-size: 1.5rem;
        }
        
        .error-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          padding: 0 20px;
          text-align: center;
        }
        
        .error-message {
          color: #ff6464;
          font-size: 1.3rem;
          margin-bottom: 30px;
        }
      `}</style>
    </div>
  );
};

export default Goals; 