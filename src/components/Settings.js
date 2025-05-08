import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase-config';
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
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

      if (!username) {
        throw new Error('Please enter a username');
      }

      // Validate username format
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
      if (!usernameRegex.test(username)) {
        throw new Error('Username must be 3-20 characters long and can only contain letters, numbers, and underscores');
      }

      // Check if username is already taken
      const usernameRef = doc(db, 'usernames', username.toLowerCase());
      const usernameDoc = await getDoc(usernameRef);
      
      if (usernameDoc.exists() && usernameDoc.data().uid !== user.uid) {
        throw new Error('This username is already taken');
      }

      // Update username in usernames collection
      await setDoc(usernameRef, {
        uid: user.uid,
        username: username,
        updatedAt: new Date()
      });

      // Remove old username if it exists and is different
      if (currentUsername && currentUsername.toLowerCase() !== username.toLowerCase()) {
        const oldUsernameRef = doc(db, 'usernames', currentUsername.toLowerCase());
        await deleteDoc(oldUsernameRef);
      }

      // Update username in user document
      await updateDoc(doc(db, 'users', user.uid), {
        username: username,
        updatedAt: new Date()
      });

      setSuccess('Username updated successfully!');
      setCurrentUsername(username);
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

      // Try to add user to friend's friends subcollection, but don't block success if it fails
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userData = userDoc.data();
        await setDoc(doc(db, 'users', friendId, 'friends', user.uid), {
          username: userData.username || currentUsername,
          addedAt: new Date()
        });
      } catch (reciprocalError) {
        console.warn('Could not add reciprocal friend entry:', reciprocalError);
      }

      // Update local friends list
      const newFriend = {
        id: friendId,
        username: friendUsername
      };
      setFriends([...friends, newFriend]);
      setFriendSuccess(`✅ ${friendUsername} added as a friend!`);
      setFriendUsername('');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setFriendSuccess('');
      }, 3000);
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