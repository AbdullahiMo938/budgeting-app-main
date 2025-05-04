import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "./firebase-config";
import { doc, setDoc, getDoc, Timestamp } from "firebase/firestore";
import "./App.css";

const Register = () => {
  const [formData, setFormData] = useState({
    username: "",
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

  // Check if username is available
  const checkUsernameAvailability = async (username) => {
    try {
      const usersRef = doc(db, "usernames", username.toLowerCase());
      const usernameDoc = await getDoc(usersRef);
      return !usernameDoc.exists();
    } catch (error) {
      console.error("Error checking username:", error);
      throw error;
    }
  };

  // Initialize user in Firestore
  const initializeUser = async (user, username) => {
    try {
      // Save username to usernames collection for uniqueness check
      const usernameRef = doc(db, "usernames", username.toLowerCase());
      await setDoc(usernameRef, {
        uid: user.uid,
        createdAt: Timestamp.now()
      });

      // Create user document
      const userRef = doc(db, "users", user.uid);
      await setDoc(userRef, {
        username: username,
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
      const { username, email, password, confirmPassword } = formData;

      // Client-side validation
      if (!username || !email || !password || !confirmPassword) {
        throw new Error("All fields are required.");
      }
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }
      if (username.length < 3 || username.length > 20) {
        throw new Error("Username must be between 3 and 20 characters.");
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        throw new Error("Username can only contain letters, numbers, and underscores.");
      }

      // Check username availability
      const isUsernameAvailable = await checkUsernameAvailability(username);
      if (!isUsernameAvailable) {
        throw new Error("Username is already taken.");
      }

      // Register the user with Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Initialize user in Firestore
      await initializeUser(user, username);

      // Display success message
      setSuccess("Registration successful! Redirecting to login...");
      console.log("Registered User:", user);

      // Redirect to login page
      setTimeout(() => {
        navigate("/login");
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
          <label htmlFor="username">Username:</label>
          <input
            type="text"
            id="username"
            name="username"
            value={formData.username}
            onChange={handleChange}
            required
            minLength="3"
            maxLength="20"
            pattern="[a-zA-Z0-9_]+"
            title="Username can only contain letters, numbers, and underscores"
          />
        </div>
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
