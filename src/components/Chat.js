import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from '../firebase-config';
import { collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, doc, getDoc, setDoc, getDocs } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import '../App.css';

const Chat = () => {
  const { categoryId } = useParams();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [currentUsername, setCurrentUsername] = useState('');
  const [showUsernamePrompt, setShowUsernamePrompt] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  // Check if user is authenticated
  useEffect(() => {
    const checkAuth = () => {
      const unsubscribe = auth.onAuthStateChanged(user => {
        if (!user) {
          console.log("User not authenticated, redirecting to login");
          navigate('/login');
        } else {
          console.log("User authenticated:", user.uid);
        }
      });
      
      return unsubscribe;
    };
    
    const unsubscribe = checkAuth();
    return () => unsubscribe();
  }, [navigate]);

  // Define default categories
  useEffect(() => {
    setCategories([
      'All',
      'Housing',
      'Transportation',
      'Food',
      'Utilities',
      'Entertainment',
      'Savings',
      'Personal',
      'Other'
    ]);
  }, []);

  // Get current user's username
  useEffect(() => {
    const fetchUsername = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          console.log("No user is signed in");
          return;
        }

        console.log("Current user:", user.uid);
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);
        
        if (userDocSnap.exists() && userDocSnap.data().username) {
          setCurrentUsername(userDocSnap.data().username);
          console.log("Username from Firestore:", userDocSnap.data().username);
        } else if (user.displayName) {
          setCurrentUsername(user.displayName);
          console.log("Using display name:", user.displayName);
          
          // Save the display name as username
          await setDoc(userDocRef, {
            username: user.displayName
          }, { merge: true });
        } else {
          setCurrentUsername('Anonymous');
          console.log("No username found, using Anonymous");
          setShowUsernamePrompt(true);
        }
      } catch (error) {
        console.error('Error fetching username:', error);
        setCurrentUsername('Anonymous');
      }
    };

    fetchUsername();
  }, []);

  // Check if we're in a category chat and set the selected category
  useEffect(() => {
    if (categoryId) {
      console.log("Category ID from URL:", categoryId);
      const category = categories.find(cat => cat.toLowerCase() === categoryId.toLowerCase());
      if (category) {
        console.log("Selected category:", category);
        setSelectedCategory(category);
      } else if (categories.length > 0) {
        // Default to first category if not found
        console.log("Category not found, defaulting to:", categories[0]);
        setSelectedCategory(categories[0]);
      }
    } else if (categories.length > 0) {
      // Default to 'All' if no category is specified
      console.log("No category specified, defaulting to All");
      setSelectedCategory('All');
      navigate('/chat/category/all', { replace: true });
    }
    setLoading(false);
  }, [categoryId, categories, navigate]);

  // Fetch messages when category is selected
  useEffect(() => {
    if (!selectedCategory) {
      console.log("No category selected, skipping message fetch");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      console.log("No user signed in, redirecting to login");
      navigate('/login');
      return;
    }

    console.log("Fetching messages for category:", selectedCategory);
    
    // For category chats, use the category name as the chat ID
    const chatId = `category_${selectedCategory.toLowerCase()}`;
    console.log("Chat ID:", chatId);
    
    // Create the category chat document if it doesn't exist
    const createCategoryDoc = async () => {
      try {
        const chatDocRef = doc(db, 'categoryChats', chatId);
        const chatDocSnap = await getDoc(chatDocRef);
        
        if (!chatDocSnap.exists()) {
          console.log("Creating new category chat document");
          await setDoc(chatDocRef, {
            category: selectedCategory,
            createdAt: serverTimestamp(),
            lastUpdated: serverTimestamp()
          });
          
          // Create an initial welcome message
          const messagesCollectionRef = collection(db, 'categoryChats', chatId, 'messages');
          const messagesQuery = query(messagesCollectionRef);
          const messagesSnapshot = await getDocs(messagesQuery);
          
          if (messagesSnapshot.empty) {
            console.log("Adding welcome message");
            await addDoc(messagesCollectionRef, {
              text: `Welcome to the ${selectedCategory} chat! Share your tips and experiences with others.`,
              senderId: 'system',
              senderName: 'Budget Battles',
              timestamp: serverTimestamp(),
              category: selectedCategory
            });
          }
        } else {
          console.log("Category chat document exists, updating lastUpdated");
          await setDoc(chatDocRef, {
            lastUpdated: serverTimestamp()
          }, { merge: true });
        }
      } catch (error) {
        console.error('Error creating/updating category document:', error);
        setDebugInfo(`Error with category doc: ${error.message}`);
      }
    };
    
    createCategoryDoc();
    
    // Set up real-time listener for category messages
    const messagesRef = collection(db, 'categoryChats', chatId, 'messages');
    const q = query(
      messagesRef,
      orderBy('timestamp', 'asc'),
      limit(100)
    );

    console.log("Setting up messages listener");
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Received ${snapshot.docs.length} messages`);
      const messageList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date()
      }));
      
      setMessages(messageList);
      
      // Scroll to bottom when new messages arrive
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }, (error) => {
      console.error('Error in messages listener:', error);
      setError(`Failed to load messages: ${error.message}`);
      setDebugInfo(`Listener error: ${error.message}`);
    });

    return () => {
      console.log("Cleaning up messages listener");
      unsubscribe && unsubscribe();
    };
  }, [selectedCategory, navigate]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!newMessage.trim()) {
      console.log("Message is empty, not sending");
      return;
    }
    
    if (!selectedCategory) {
      console.log("No category selected, cannot send message");
      return;
    }
    
    setSendingMessage(true);
    setSendError(null);
    
    // Create a temporary message to show immediately
    const tempMessage = {
      id: `temp-${Date.now()}`,
      text: newMessage.trim(),
      senderId: auth.currentUser?.uid || 'unknown',
      senderName: currentUsername || 'Anonymous',
      timestamp: new Date(),
      category: selectedCategory,
      sending: true
    };
    
    // Add the temporary message to the local state
    setMessages(prevMessages => [...prevMessages, tempMessage]);
    
    // Store the message text and clear the input
    const messageText = newMessage.trim();
    setNewMessage('');
    
    try {
      const user = auth.currentUser;
      if (!user) {
        console.log("No user signed in, redirecting to login");
        navigate('/login');
        return;
      }

      console.log("Current user ID:", user.uid);
      console.log("Current username:", currentUsername);

      // Use the currentUsername state
      const senderName = currentUsername || 'Anonymous';

      // For category chats
      const chatId = `category_${selectedCategory.toLowerCase()}`;
      console.log("Sending message to chat ID:", chatId);
      
      // Ensure the category chat document exists
      const chatDocRef = doc(db, 'categoryChats', chatId);
      await setDoc(chatDocRef, {
        category: selectedCategory,
        lastUpdated: serverTimestamp()
      }, { merge: true });
      
      // Create messages collection if it doesn't exist
      const messagesCollectionRef = collection(db, 'categoryChats', chatId, 'messages');
      
      // Add message to Firestore with explicit fields
      const messageData = {
        text: messageText,
        senderId: user.uid,
        senderName: senderName,
        timestamp: serverTimestamp(),
        category: selectedCategory
      };
      
      // Log the message data for debugging
      console.log('Sending message data:', JSON.stringify(messageData));
      
      // Add the document to Firestore
      const docRef = await addDoc(messagesCollectionRef, messageData);
      console.log('Message sent successfully with ID:', docRef.id);

      // Remove the temporary message (it will be replaced by the real one from Firestore)
      setMessages(prevMessages => prevMessages.filter(msg => msg.id !== tempMessage.id));
      setDebugInfo(null);
    } catch (error) {
      console.error('Error sending message:', error);
      setSendError(`Failed to send message: ${error.message}`);
      setDebugInfo(`Send error: ${error.message}, Code: ${error.code}`);
      
      // Remove the temporary message
      setMessages(prevMessages => prevMessages.filter(msg => msg.id !== tempMessage.id));
      
      // Restore the message text to the input
      setNewMessage(messageText);
      
      setTimeout(() => setSendError(null), 5000);
    } finally {
      setSendingMessage(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleCategorySelect = (category) => {
    setSelectedCategory(category);
    navigate(`/chat/category/${category.toLowerCase()}`, { replace: true });
  };

  const getCategoryIcon = (category) => {
    const icons = {
      'All': '📊',
      'Housing': '🏠',
      'Transportation': '🚗',
      'Food': '🍔',
      'Utilities': '💡',
      'Entertainment': '🎬',
      'Savings': '💰',
      'Personal': '👤',
      'Other': '📦'
    };
    return icons[category] || '📊';
  };

  const handleSaveUsername = async () => {
    if (!newUsername.trim()) return;
    
    setSavingUsername(true);
    
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }
      
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
        username: newUsername.trim()
      }, { merge: true });
      
      setCurrentUsername(newUsername.trim());
      setShowUsernamePrompt(false);
    } catch (error) {
      console.error('Error saving username:', error);
      setSendError('Failed to save username. Please try again.');
      setTimeout(() => setSendError(null), 3000);
    } finally {
      setSavingUsername(false);
    }
  };

  // Test Firestore connection
  const testFirestoreConnection = async () => {
    try {
      setDebugInfo("Testing Firestore connection...");
      
      // Try to read a document from Firestore
      const testDocRef = doc(db, 'test', 'connection');
      await setDoc(testDocRef, {
        timestamp: serverTimestamp(),
        testId: 'connection-test'
      });
      
      // Try to read it back
      const docSnap = await getDoc(testDocRef);
      
      if (docSnap.exists()) {
        setDebugInfo("Firestore connection successful! ✅");
        setTimeout(() => setDebugInfo(null), 3000);
      } else {
        setDebugInfo("Firestore connection test: Document created but couldn't be read back");
      }
    } catch (error) {
      console.error("Firestore connection test failed:", error);
      setDebugInfo(`Firestore connection failed: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div className="chat-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading chat...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-container">
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Try Again</button>
          <button onClick={testFirestoreConnection}>Test Connection</button>
          {debugInfo && (
            <div className="debug-info">
              <p>Debug Info: {debugInfo}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <h2>Category Chat</h2>
      
      {currentUsername && (
        <div className="current-user-info">
          Chatting as: <span className="current-username">{currentUsername}</span>
          {currentUsername === 'Anonymous' && (
            <button 
              className="set-username-btn"
              onClick={() => setShowUsernamePrompt(true)}
            >
              Set Username
            </button>
          )}
          <button 
            className="test-connection-btn"
            onClick={testFirestoreConnection}
          >
            Test Connection
          </button>
        </div>
      )}
      
      {showUsernamePrompt && (
        <div className="username-prompt">
          <h3>Set Your Username</h3>
          <p>Please set a username to chat with others.</p>
          <div className="username-form">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Enter a username..."
              className="username-input"
              disabled={savingUsername}
            />
            <button 
              onClick={handleSaveUsername}
              disabled={savingUsername || !newUsername.trim()}
              className="save-username-btn"
            >
              {savingUsername ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
      
      <div className="chat-interface">
        <div className="friends-sidebar">
          <h3>Categories</h3>
          <ul className="chat-category-list">
            {categories.map(category => (
              <li 
                key={category} 
                className={`chat-category-item ${selectedCategory === category ? 'active' : ''}`}
                onClick={() => handleCategorySelect(category)}
              >
                <div className="category-icon">{getCategoryIcon(category)}</div>
                <span className="category-name">{category}</span>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="chat-main">
          {selectedCategory ? (
            <>
              <div className="chat-header">
                <h3>
                  {getCategoryIcon(selectedCategory)} {selectedCategory} Chat
                </h3>
              </div>
              
              <div className="messages-container">
                {messages.length > 0 ? (
                  <div className="messages-list">
                    {messages.map(message => (
                      <div 
                        key={message.id} 
                        className={`message ${message.senderId === auth.currentUser?.uid ? 'sent' : 'received'} ${message.sending ? 'sending' : ''}`}
                      >
                        {message.senderId !== auth.currentUser?.uid && (
                          <div className="message-sender">{message.senderName}</div>
                        )}
                        <div className="message-content">
                          <p>{message.text}</p>
                          <span className="message-time">
                            {message.sending ? 'Sending...' : formatTimestamp(message.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                ) : (
                  <div className="no-messages">
                    <p>No messages in this category yet. Start the conversation!</p>
                  </div>
                )}
              </div>
              
              <form className="message-form" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={`Message in ${selectedCategory}...`}
                  className="message-input"
                  disabled={sendingMessage}
                />
                <button 
                  type="submit" 
                  className="send-button"
                  disabled={sendingMessage || !newMessage.trim()}
                >
                  {sendingMessage ? 'Sending...' : 'Send'}
                </button>
              </form>
              {sendError && (
                <div className="send-error-message">
                  {sendError}
                </div>
              )}
              {debugInfo && (
                <div className="debug-info">
                  <p>Debug Info: {debugInfo}</p>
                  <button onClick={() => setDebugInfo(null)}>Clear</button>
                </div>
              )}
            </>
          ) : (
            <div className="select-chat-prompt">
              <p>Select a category to start chatting</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Chat; 