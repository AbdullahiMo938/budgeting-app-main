import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaHome, FaChartLine, FaWallet, FaPlusCircle, FaUsers, FaCog, FaComments } from 'react-icons/fa';
import { auth } from '../firebase-config';
import ErrorBoundary from './ErrorBoundary';

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleNavigation = (path) => {
    if (!user) {
      navigate('/login');
      return;
    }
    navigate(path);
  };

  const isActive = (path) => {
    return location.pathname === path ? 'nav-button active' : 'nav-button';
  };

  const navItems = [
    {
      section: "Main",
      items: [
        { path: '/dashboard', label: 'Home', icon: <FaHome />, requiresAuth: true },
        { path: '/add-transaction', label: 'Add Transaction', icon: <FaPlusCircle />, requiresAuth: true },
      ]
    },
    {
      section: "Analysis",
      items: [
        { path: '/budget-optimization', label: 'Budget Insights', icon: <FaChartLine />, requiresAuth: true },
        { path: '/mystats', label: 'My Stats', icon: <FaWallet />, requiresAuth: true },
      ]
    },
    {
      section: "Account",
      items: [
        { path: '/allstats', label: 'Leaderboard', icon: <FaUsers />, requiresAuth: true },
        { path: '/chat/category/all', label: 'Category Chat', icon: <FaComments />, requiresAuth: true },
        { path: '/settings', label: 'Settings', icon: <FaCog />, requiresAuth: true },
      ]
    }
  ];

  if (isLoading) {
    return <div className="loading-nav">Loading...</div>;
  }

  return (
    <ErrorBoundary>
      <div className="navigation-wrapper">
        <nav className="navigation">
          {navItems.map((section, idx) => (
            <div key={idx} className="nav-section">
              <h3 className="nav-section-title">{section.section}</h3>
              <div className="nav-section-items">
                {section.items.map((item) => (
                  <button
                    key={item.path}
                    className={`${isActive(item.path)} ${!user && item.requiresAuth ? 'disabled' : ''}`}
                    onClick={() => handleNavigation(item.path)}
                    disabled={!user && item.requiresAuth}
                    title={!user && item.requiresAuth ? 'Please login to access' : item.label}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        {user && (
          <button 
            className="logout-button"
            onClick={() => {
              auth.signOut();
              navigate('/');
            }}
          >
            Logout
          </button>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default Navigation; 