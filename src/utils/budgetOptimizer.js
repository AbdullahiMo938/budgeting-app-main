import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase-config';

// Get weekly spending patterns for a user
const getWeeklySpending = async (userId) => {
  try {
    console.log("Fetching weekly spending for user:", userId);
    
    // Get transactions from the last week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const transactionsRef = collection(db, 'transactions');
    const q = query(
      transactionsRef,
      where('userId', '==', userId),
      where('timestamp', '>=', Timestamp.fromDate(oneWeekAgo))
    );

    const querySnapshot = await getDocs(q);
    const weeklySpending = {};

    // Process each transaction
    querySnapshot.forEach(doc => {
      const data = doc.data();
      if (data.category && data.amount) {
        weeklySpending[data.category] = (weeklySpending[data.category] || 0) + Number(data.amount);
      }
    });

    // Ensure all categories have a value
    const defaultCategories = [
      'Housing', 'Transportation', 'Food', 'Utilities',
      'Entertainment', 'Savings', 'Personal', 'Other'
    ];

    defaultCategories.forEach(category => {
      if (!weeklySpending[category]) {
        weeklySpending[category] = 0;
      }
    });

    console.log("Weekly spending calculated:", weeklySpending);
    return weeklySpending;
  } catch (error) {
    console.error("Error getting weekly spending:", error);
    throw error;
  }
};

// Calculate optimized budget based on spending patterns
export const calculateOptimizedBudget = async (userId, currentBudget) => {
  try {
    console.log("Starting budget optimization calculation for user:", userId);
    
    // Validate inputs
    if (!userId) {
      console.error("Missing userId in calculateOptimizedBudget");
      return { currentBudget, needsOptimization: false };
    }
    
    if (typeof currentBudget !== 'number' || isNaN(currentBudget)) {
      console.error("Invalid currentBudget in calculateOptimizedBudget:", currentBudget);
      return { currentBudget: 0, needsOptimization: false };
    }
    
    const weeklySpending = await getWeeklySpending(userId);
    console.log("Weekly spending retrieved:", weeklySpending);
    
    const monthlySpending = {};
    const WEEKS_IN_MONTH = 4;
    
    // Project monthly spending based on weekly patterns
    Object.keys(weeklySpending).forEach(category => {
      monthlySpending[category] = weeklySpending[category] * WEEKS_IN_MONTH;
    });
    
    console.log("Monthly spending calculated:", monthlySpending);

    // Calculate total projected monthly spending
    const totalProjectedSpending = Object.values(monthlySpending).reduce((sum, amount) => sum + amount, 0);
    console.log("Total projected spending:", totalProjectedSpending);
    
    // If projected spending is significantly different from current budget, suggest optimization
    const THRESHOLD = 0.15; // 15% threshold for adjustment
    const difference = Math.abs(currentBudget - totalProjectedSpending) / currentBudget;
    console.log("Budget difference:", difference, "Threshold:", THRESHOLD);

    if (difference > THRESHOLD) {
      // Calculate new suggested budget
      const suggestedBudget = (currentBudget + totalProjectedSpending) / 2;
      console.log("Suggested budget:", suggestedBudget);
      
      // Calculate category-specific recommendations
      const recommendations = {};
      Object.entries(monthlySpending).forEach(([category, amount]) => {
        const percentageOfTotal = amount / totalProjectedSpending;
        recommendations[category] = {
          currentSpending: amount,
          suggestedAllocation: suggestedBudget * percentageOfTotal,
          percentageOfBudget: (percentageOfTotal * 100).toFixed(1)
        };
      });
      
      console.log("Budget optimization completed with recommendations");
      return {
        currentBudget,
        suggestedBudget,
        recommendations,
        needsOptimization: true
      };
    }

    console.log("Budget optimization completed, no optimization needed");
    return {
      currentBudget,
      needsOptimization: false
    };
  } catch (error) {
    console.error("Error in calculateOptimizedBudget:", error);
    // Return a safe default value instead of throwing an error
    return {
      currentBudget,
      needsOptimization: false,
      error: error.message
    };
  }
};

// Get spending alerts based on patterns
export const getSpendingAlerts = (optimizationData) => {
  try {
    console.log("Generating spending alerts from optimization data");
    
    if (!optimizationData || !optimizationData.needsOptimization) {
      console.log("No optimization needed, no alerts generated");
      return [];
    }

    const alerts = [];
    const { recommendations, currentBudget, suggestedBudget } = optimizationData;

    if (!recommendations || !currentBudget || !suggestedBudget) {
      console.warn("Missing data in optimizationData:", optimizationData);
      return [];
    }

    if (suggestedBudget < currentBudget) {
      alerts.push({
        type: 'warning',
        message: `Your spending patterns suggest you might be over-budgeting. Consider reducing your budget from £${currentBudget.toFixed(2)} to £${suggestedBudget.toFixed(2)}.`
      });
    } else {
      alerts.push({
        type: 'info',
        message: `Based on your spending, you might need to increase your budget from £${currentBudget.toFixed(2)} to £${suggestedBudget.toFixed(2)}.`
      });
    }

    // Add category-specific alerts
    Object.entries(recommendations).forEach(([category, data]) => {
      if (data.currentSpending > data.suggestedAllocation * 1.2) { // 20% over suggested
        alerts.push({
          type: 'warning',
          message: `High spending in ${category}: ${data.percentageOfBudget}% of your budget. Consider reducing expenses in this category.`
        });
      }
    });

    console.log("Generated alerts:", alerts);
    return alerts;
  } catch (error) {
    console.error("Error in getSpendingAlerts:", error);
    return [];
  }
}; 