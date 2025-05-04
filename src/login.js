import React, { useState, useEffect } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "./firebase-config";
import { doc, setDoc, getDoc, Timestamp } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./App.css";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Check if user is already logged in
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        // User is already logged in, redirect to dashboard
        navigate("/dashboard");
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  // Initialize user in Firestore if they don't exist
  const initializeUser = async (user) => {
    try {
      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        // Create a new user document
        await setDoc(userRef, {
          email: user.email,
          createdAt: Timestamp.now(),
          lastLogin: Timestamp.now(),
          userId: user.uid,
          budget: 2000, // Default budget
          categories: [
            { name: "Housing", allocation: 600, percentage: 30 },
            { name: "Transportation", allocation: 300, percentage: 15 },
            { name: "Food", allocation: 300, percentage: 15 },
            { name: "Utilities", allocation: 200, percentage: 10 },
            { name: "Entertainment", allocation: 200, percentage: 10 },
            { name: "Savings", allocation: 200, percentage: 10 },
            { name: "Personal", allocation: 100, percentage: 5 },
            { name: "Other", allocation: 100, percentage: 5 }
          ]
        });
        console.log("New user created in Firestore");
        navigate("/settings");
      } else {
        // Update last login time
        await setDoc(userRef, { lastLogin: Timestamp.now() }, { merge: true });
        console.log("User login time updated");
        
        // Check if user has a username
        const userData = userDoc.data();
        if (!userData.username) {
          navigate("/settings"); // Redirect to settings if no username
        } else {
          navigate("/dashboard"); // Otherwise go to dashboard
        }
      }
    } catch (error) {
      console.error("Error initializing user in Firestore:", error);
      // Continue anyway, as this is not critical
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Log in using email and password
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Ensure we have a fresh token
      await user.getIdToken(true);
      console.log("User authenticated with email:", user.email);

      // Initialize user in Firestore
      await initializeUser(user);

      // Redirect to the dashboard
      navigate("/dashboard");
    } catch (error) {
      console.error("Email Login failed:", error);
      
      if (error.code === "auth/user-not-found") {
        setError("User not found. Please check your email or register.");
      } else if (error.code === "auth/wrong-password") {
        setError("Incorrect password. Please try again.");
      } else if (error.code === "auth/invalid-email") {
        setError("Invalid email format. Please enter a valid email.");
      } else if (error.code === "auth/too-many-requests") {
        setError("Too many failed login attempts. Please try again later.");
      } else {
        setError("Login failed. Please check your credentials.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <h2>Login</h2>
      {error && <p className="error-message">{error}</p>}

      {/* Email/Password Login Form */}
      <form onSubmit={handleEmailLogin}>
        <div className="form-group">
          <label htmlFor="email">Email:</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password:</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <button type="submit" className="email-login-button" disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
      
      <div className="register-link">
        <button 
          onClick={() => navigate('/register')} 
          className="register-button"
          disabled={loading}
        >
          Create New Account
        </button>
      </div>
    </div>
  );
};

export default Login;
