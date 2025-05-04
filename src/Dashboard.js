import React from 'react';
import { useNavigate } from 'react-router-dom';
import './App.css';

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <div className="dashboard-container">
      <h2>Dashboard</h2>
      <p>Welcome to your budget dashboard!</p>
      
      <div className="dashboard-actions">
        <button onClick={() => navigate('/add-transaction')}>
          Add Transaction
        </button>
        <button onClick={() => navigate('/budget-optimization')}>
          View Budget Insights
        </button>
        <button onClick={() => navigate('/mystats')}>
          View My Stats
        </button>
      </div>
    </div>
  );
};

export default Dashboard;





