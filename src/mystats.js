import React, { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { db, auth } from "./firebase-config";
import { collection, query, where, getDocs } from "firebase/firestore";
import "./App.css";
import { useNavigate } from "react-router-dom";

const MyStats = () => {
  const [userData, setUserData] = useState([]);
  const [allUsersData, setAllUsersData] = useState([]);
  const [budgetData, setBudgetData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          setError("You must be logged in to view your stats.");
          setLoading(false);
          return;
        }

        const userId = user.uid;
        const userStatsQuery = query(collection(db, "spendingStats"), where("userId", "==", userId));
        const allStatsQuery = collection(db, "spendingStats");
        
        const [userQuerySnapshot, allUsersQuerySnapshot] = await Promise.all([
          getDocs(userStatsQuery),
          getDocs(allStatsQuery)
        ]);

        if (userQuerySnapshot.empty) {
          setError("No stats found. Start by adding your spending stats!");
          setLoading(false);
          return;
        }

        let formatStats = (querySnapshot) => {
          let formattedData = [];
          let budgetBreakdown = {};
          querySnapshot.docs.forEach((doc) => {
            const docData = doc.data();
            const date = docData.timestamp?.toDate().toLocaleDateString() || "Unknown Date";
            
            Object.entries(docData.spendingStats || {}).forEach(([category, subcategories]) => {
              Object.entries(subcategories).forEach(([subcategory, amount]) => {
                formattedData.push({
                  date,
                  category: `${category} - ${subcategory}`,
                  spending: amount,
                  description: `${category}: ${subcategory} (£${amount})`,
                  user: docData.userId === userId ? "You" : "Others"
                });

                budgetBreakdown[category] = (budgetBreakdown[category] || 0) + amount;
              });
            });
          });
          return { formattedData, budgetBreakdown };
        };

        const userStats = formatStats(userQuerySnapshot);
        const allUsersStats = formatStats(allUsersQuerySnapshot);

        setUserData(userStats.formattedData);
        setAllUsersData(allUsersStats.formattedData);
        setBudgetData(Object.entries(userStats.budgetBreakdown).map(([name, value]) => ({ name, value })));
        setLoading(false);
      } catch (error) {
        console.error("Error fetching stats:", error);
        setError("Failed to fetch stats. Please try again later.");
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#FF4567"];

  if (loading) {
    return <p>Loading your stats...</p>;
  }

  if (error) {
    return <p className="error-message">{error}</p>;
  }

  return (
    <div className="mystats-container">
      <h1>Your Spending Stats vs Others</h1>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip formatter={(value, name, props) => [
            `£${value}`, 
            `${props.payload.description}`
          ]} />
          <Legend />
          <Line type="monotone" data={userData} dataKey="spending" stroke="#0ef" strokeWidth={3} dot={{ r: 5 }} name="Your Spending" />
          <Line type="monotone" data={allUsersData} dataKey="spending" stroke="#f00" strokeWidth={3} dot={{ r: 5 }} name="Others' Spending" />
        </LineChart>
      </ResponsiveContainer>
      <h2>Budget Breakdown</h2>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={budgetData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} fill="#8884d8" label>
            {budgetData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value, name) => [`£${value}`, name]} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      <button onClick={() => navigate("/allstats")} className="allstats-button">
        View Everyone's Stats
      </button>
    </div>
  );
};

export default MyStats;
