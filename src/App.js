import React from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import Login from "./login";
import Register from "./register";
import InputStats from "./inputStats";
import MyStats from "./mystats";
import "./App.css";
import AllStats from "./allstats";
import Dashboard from "./Dashboard";
import AddTransaction from "./addTranscation";
import BudgetDashboard from "./components/BudgetDashboard";
import Navigation from "./components/Navigation";
import Settings from "./components/Settings";
import Chat from "./components/Chat";

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const isAuthPage = ["/login", "/register"].includes(location.pathname);

  return (
    <div className="app-container">
      {/* Show Navigation only when not on home or auth pages */}
      {!isHomePage && !isAuthPage && <Navigation />}

      {isHomePage && (
        <div className="welcome-container">
          <h1>Welcome to BudgetBattles</h1>
          <p>Manage your budget efficiently and compete with friends!</p>
          <div className="welcome-buttons">
            <button onClick={() => navigate("/login")} className="login-button">
              Go to Login
            </button>
            <button onClick={() => navigate("/register")} className="register-button">
              Register
            </button>
          </div>
        </div>
      )}

      {/* Define Routes */}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/inputstats" element={<InputStats />} />
        <Route path="/mystats" element={<MyStats />} />
        <Route path="/allstats" element={<AllStats />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/add-transaction" element={<AddTransaction />} />
        <Route path="/budget-optimization" element={<BudgetDashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/chat/category/:categoryId" element={<Chat />} />
      </Routes>
    </div>
  );
}

export default App;
