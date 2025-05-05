import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase-config';
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import '../App.css';

const Settings = () => {
  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');
  const [friendUsername, setFriendUsername] = useState('');
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [friendError, setFriendError] = useState('');
  const [friendSuccess, setFriendSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          navigate('/login');
          return;
        }

        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.username) {
            setCurrentUsername(userData.username);
            setUsername(userData.username);
          }
          // Fetch friends from subcollection
          const friendsSnapshot = await getDocs(collection(db, 'users', user.uid, 'friends'));
          const friendsList = friendsSnapshot.docs.map(doc => ({
            id: doc.id,
            username: doc.data().username
          }));
          setFriends(friendsList);
        }
        setLoading(false);
      } catch (error) {
        console.error('Error fetching user data:', error);
        setError('Error loading user data');
        setLoading(false);
      }
    };

    fetchUserData();
  }, [navigate]);

  const checkUsernameAvailability = async (username) => {
    try {
      const usernameRef = doc(db, 'usernames', username.toLowerCase());
      const usernameDoc = await getDoc(usernameRef);
      
      // Username is available if it doesn't exist or belongs to current user
      if (!usernameDoc.exists()) return true;
      return usernameDoc.data().uid === auth.currentUser.uid;
    } catch (error) {
      console.error('Error checking username:', error);
      throw error;
    }
  };

  const handleUsernameUpdate = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in to update your username');
      }

      // Username validation
      if (!username) {
        throw new Error('Username is required');
      }
      if (username.length < 3 || username.length > 20) {
        throw new Error('Username must be between 3 and 20 characters');
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        throw new Error('Username can only contain letters, numbers, and underscores');
      }

      // If username hasn't changed, no need to update
      if (username === currentUsername) {
        setLoading(false);
        return;
      }

      // Check if new username is available
      const isAvailable = await checkUsernameAvailability(username);
      if (!isAvailable) {
        throw new Error('Username is already taken');
      }

      // First, create the new username document
      const newUsernameRef = doc(db, 'usernames', username.toLowerCase());
      await setDoc(newUsernameRef, {
        uid: user.uid,
        createdAt: new Date()
      });

      // Then update the user document
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        username: username,
        lastUpdated: new Date()
      }, { merge: true });

      // Finally, delete the old username document if it exists
      if (currentUsername) {
        const oldUsernameRef = doc(db, 'usernames', currentUsername.toLowerCase());
        await deleteDoc(oldUsernameRef);
      }

      setCurrentUsername(username);
      setSuccess('Username updated successfully!');
    } catch (error) {
      console.error('Error updating username:', error);
      setError(error.message || 'Error updating username');
    } finally {
      setLoading(false);
    }
  };

  const handleAddFriend = async (e) => {
    e.preventDefault();
    setFriendError('');
    setFriendSuccess('');
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in to add friends');
      }

      if (!friendUsername) {
        throw new Error('Please enter a username');
      }

      // Check if trying to add self
      if (friendUsername.toLowerCase() === currentUsername.toLowerCase()) {
        throw new Error('You cannot add yourself as a friend');
      }

      // Find user by username
      const usernameRef = doc(db, 'usernames', friendUsername.toLowerCase());
      const usernameDoc = await getDoc(usernameRef);

      if (!usernameDoc.exists()) {
        throw new Error('User not found');
      }

      const friendId = usernameDoc.data().uid;

      // Check if already friends
      const friendDoc = await getDoc(doc(db, 'users', user.uid, 'friends', friendId));
      if (friendDoc.exists()) {
        throw new Error('You are already friends with this user');
      }

      // Add friend to user's friends subcollection
      await setDoc(doc(db, 'users', user.uid, 'friends', friendId), {
        username: friendUsername,
        addedAt: new Date()
      });

      // Add user to friend's friends subcollection
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      await setDoc(doc(db, 'users', friendId, 'friends', user.uid), {
        username: userData.username || currentUsername,
        addedAt: new Date()
      });

      // Update local friends list
      const newFriend = {
        id: friendId,
        username: friendUsername
      };
      setFriends([...friends, newFriend]);
      setFriendSuccess('Friend added successfully!');
      setFriendUsername('');
    } catch (error) {
      console.error('Error adding friend:', error);
      setFriendError(error.message || 'Error adding friend');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFriend = async (friendId, friendUsername) => {
    setLoading(true);
    setFriendError('');
    setFriendSuccess('');

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in to remove friends');
      }

      // Remove friend from user's friends subcollection
      await deleteDoc(doc(db, 'users', user.uid, 'friends', friendId));

      // Remove user from friend's friends subcollection
      await deleteDoc(doc(db, 'users', friendId, 'friends', user.uid));

      // Update local friends list
      setFriends(friends.filter(friend => friend.id !== friendId));
      setFriendSuccess(`Removed ${friendUsername} from friends`);
    } catch (error) {
      console.error('Error removing friend:', error);
      setFriendError(error.message || 'Error removing friend');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <h2>Settings</h2>
      
      <div className="settings-section">
        <h3>Username Settings</h3>
        {error && <p className="error-message">{error}</p>}
        {success && <p className="success-message">{success}</p>}
        
        <form onSubmit={handleUsernameUpdate}>
          <div className="form-group">
            <label htmlFor="username">Username:</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              minLength="3"
              maxLength="20"
              pattern="[a-zA-Z0-9_]+"
              title="Username can only contain letters, numbers, and underscores"
              disabled={loading}
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Updating...' : 'Update Username'}
          </button>
        </form>
      </div>

      <div className="settings-section">
        <h3>Friend Management</h3>
        {friendError && <p className="error-message">{friendError}</p>}
        {friendSuccess && <p className="success-message">{friendSuccess}</p>}
        
        <form onSubmit={handleAddFriend} className="friend-form">
          <div className="form-group">
            <label htmlFor="friendUsername">Add Friend by Username:</label>
            <div className="friend-input-group">
              <input
                type="text"
                id="friendUsername"
                value={friendUsername}
                onChange={(e) => setFriendUsername(e.target.value)}
                placeholder="Enter friend's username"
                disabled={loading}
              />
              <button type="submit" disabled={loading}>
                {loading ? 'Adding...' : 'Add Friend'}
              </button>
            </div>
          </div>
        </form>

        <div className="friends-list">
          <h4>Your Friends</h4>
          {friends.length > 0 ? (
            <ul>
              {friends.map(friend => (
                <li key={friend.id}>
                  <span>{friend.username}</span>
                  <button
                    onClick={() => handleRemoveFriend(friend.id, friend.username)}
                    disabled={loading}
                    className="remove-friend-button"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="no-friends-message">You haven't added any friends yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings; 