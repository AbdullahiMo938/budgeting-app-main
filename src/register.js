import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "./firebase-config";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import "./App.css";

const Register = () => {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Handle form input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  // Initialize user in Firestore
  const initializeUser = async (user) => {
    try {
      // Create user document
      const userRef = doc(db, "users", user.uid);
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

      console.log("User initialized successfully");
    } catch (error) {
      console.error("Error initializing user:", error);
      throw error;
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const { email, password, confirmPassword } = formData;

      // Client-side validation
      if (!email || !password || !confirmPassword) {
        throw new Error("All fields are required.");
      }
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }

      // Register the user with Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Ensure we have a fresh token
      await user.getIdToken(true);

      // Initialize user in Firestore
      await initializeUser(user);

      // Display success message
      setSuccess("Registration successful! Redirecting to settings...");
      console.log("Registered User:", user);

      // Redirect to settings page to set username
      setTimeout(() => {
        navigate("/settings");
      }, 2000);
    } catch (error) {
      console.error("Registration Error:", error);
      setError(error.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-container">
      <h2>Register</h2>
      {error && <p className="error-message">{error}</p>}
      {success && <p className="success-message">{success}</p>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email:</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password:</label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm Password:</label>
          <input
            type="password"
            id="confirmPassword"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Registering..." : "Register"}
        </button>
      </form>
      <div className="login-redirect">
        <p>Already have an account?</p>
        <button onClick={() => navigate("/login")} disabled={loading}>Login Here</button>
      </div>
    </div>
  );
};

export default Register;
