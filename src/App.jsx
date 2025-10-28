import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
  signOut 
} from 'firebase/auth';
import { 
  getFirestore, doc, collection, onSnapshot, setDoc, addDoc, 
  query, where, serverTimestamp, updateDoc, deleteDoc, getDocs, 
  setLogLevel 
} from 'firebase/firestore';
import {
  Menu, X, Plus, Users, Clock, Settings, Send, Calendar, CheckCircle, 
  AlertTriangle, Loader, BarChart2, MessageSquare, Edit, Trash2, LogOut, Info
} from 'lucide-react';

// --- Global Firebase & Auth Variables ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// AI Model Configuration
const AI_MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL_NAME}:generateContent?key=`;

// --- Utility Functions ---

/** Converts text status to Tailwind color classes */
const getStatusColor = (status) => {
  switch (status) {
    case 'Done': return 'bg-green-100 text-green-800 border-green-300';
    case 'Processing': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'Todo': return 'bg-red-100 text-red-800 border-red-300';
    default: return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

/** Converts a Firebase Timestamp to a readable date string (or Date object) */
const formatTimestamp = (timestamp, includeTime = false) => {
  if (!timestamp || !timestamp.toDate) return 'N/A';
  const date = timestamp.toDate();
  const options = { 
    month: 'short', day: 'numeric', year: 'numeric',
    ...(includeTime && { hour: '2-digit', minute: '2-digit' })
  };
  return date.toLocaleDateString('en-US', options);
};

// Simple debounce function for input
const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
};

// --- Firebase Initialization & Authentication ---

const useFirebase = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    if (Object.keys(firebaseConfig).length === 0) {
      console.error("Firebase config is missing. Cannot initialize Firestore.");
      return;
    }

    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const userAuth = getAuth(app);
      setLogLevel('debug'); // Enable detailed Firestore logging

      setDb(firestore);
      setAuth(userAuth);

      const unsubscribe = onAuthStateChanged(userAuth, async (user) => {
        if (!user) {
          // Attempt sign-in with custom token or anonymously
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(userAuth, initialAuthToken);
            } else {
              await signInAnonymously(userAuth);
            }
          } catch (error) {
            console.error("Authentication failed:", error);
            // Fallback to anonymous if custom token fails
            if (!userAuth.currentUser) {
                await signInAnonymously(userAuth);
            }
          }
        }
        
        // Finalize state after auth attempt
        if (userAuth.currentUser) {
            setUserId(userAuth.currentUser.uid);
        } else {
             // Generate random ID for unauthenticated fallback (shouldn't happen with anonymous sign-in)
            setUserId(crypto.randomUUID());
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Error initializing Firebase:", e);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    if (auth) {
      await signOut(auth);
      // Force reload or re-auth to get a new anonymous/custom token user
      window.location.reload(); 
    }
  }, [auth]);


  return { db, auth, userId, isAuthReady, handleSignOut };
};

// --- Firestore Data Hooks ---

/** Fetches data from a public collection */
const usePublicCollection = (db, isReady, collectionName) => {
  const [data, setData] = useState([]);
  const collectionPath = `/artifacts/${appId}/public/data/${collectionName}`;

  useEffect(() => {
    if (!db || !isReady) return;

    try {
      const q = query(collection(db, collectionPath));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setData(items);
      }, (error) => {
        console.error("Error listening to public collection:", collectionName, error);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Failed to set up listener for:", collectionName, e);
    }
  }, [db, isReady, collectionName, collectionPath]);

  return data;
};

/** Fetches chat history from a private user collection */
const usePrivateChatHistory = (db, isReady, userId) => {
  const [history, setHistory] = useState([]);
  const collectionPath = `/artifacts/${appId}/users/${userId}/chat_history`;

  useEffect(() => {
    if (!db || !isReady || !userId) return setHistory([]);

    try {
      // Query sorted by timestamp
      const q = query(collection(db, collectionPath)); 
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })).sort((a, b) => a.timestamp?.toMillis() - b.timestamp?.toMillis());
        setHistory(items);
      }, (error) => {
        console.error("Error listening to chat history:", error);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Failed to set up chat listener:", e);
    }
  }, [db, isReady, userId, collectionPath]);

  return history;
};


// --- Gemini API Handler ---

const callGeminiApi = async (systemPrompt, userQuery, grounded, chatHistory) => {
  const apiKey = ""; // Canvas provides the key
  const finalApiUrl = `${API_URL}${apiKey}`;

  // Format history for API payload (assuming user/model roles)
  const formattedHistory = chatHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));
  
  // Add current user query to history
  formattedHistory.push({ role: 'user', parts: [{ text: userQuery }] });

  const payload = {
    contents: formattedHistory,
    ...(grounded && { tools: [{ google_search: {} }] }),
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };

  try {
    let response = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      const res = await fetch(finalApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        response = await res.json();
        break;
      }
      
      // Handle throttling/retry with exponential backoff
      if (res.status === 429 && attempts < maxAttempts) {
        const delay = Math.pow(2, attempts) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`API call failed with status: ${res.status}`);
      }
    }
    
    if (!response) {
         throw new Error("API call failed after max retries.");
    }
    
    const candidate = response.candidates?.[0];

    if (candidate && candidate.content?.parts?.[0]?.text) {
      const text = candidate.content.parts[0].text;
      
      let sources = [];
      const groundingMetadata = candidate.groundingMetadata;
      if (groundingMetadata && groundingMetadata.groundingAttributions) {
        sources = groundingMetadata.groundingAttributions
          .map(attr => ({
            uri: attr.web?.uri,
            title: attr.web?.title,
          }))
          .filter(source => source.uri && source.title);
      }
      return { text, sources };

    } else {
      console.error("Unexpected API response structure:", response);
      return { text: "Sorry, I received an incomplete response from the AI.", sources: [] };
    }

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return { text: `An error occurred: ${error.message}. Please try again.`, sources: [] };
  }
};

// --- Component: Alert Banner ---

const AlertBanner = ({ alerts, onClose }) => {
  if (alerts.length === 0) return null;

  const typeStyles = {
    warning: 'bg-yellow-500 border-yellow-700',
    danger: 'bg-red-600 border-red-800',
    info: 'bg-blue-600 border-blue-800'
  };
  
  const TypeIcon = ({ type }) => {
    switch(type) {
      case 'warning': return <AlertTriangle size={20} />;
      case 'danger': return <AlertTriangle size={20} />;
      case 'info': return <Info size={20} />;
      default: return null;
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4 shadow-2xl">
      <div className={`text-white p-3 rounded-lg border-l-4 ${typeStyles[alerts[0].type || 'info']} flex items-start gap-4`}>
        <TypeIcon type={alerts[0].type} className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          {alerts.map((alert, index) => (
            <p key={alert.id} className="text-sm font-medium">
              <span dangerouslySetInnerHTML={{ __html: alert.message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
              {alerts.length > 1 && index < alerts.length - 1 && ' | '}
            </p>
          ))}
        </div>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-white hover:bg-opacity-20 flex-shrink-0">
          <X size={20} />
        </button>
      </div>
    </div>
  );
};


// --- Component: Sidebar ---

const Sidebar = ({ 
  communities, 
  selectedCommunityId, 
  setSelectedCommunityId, 
  view, 
  setView, 
  userId, 
  handleSignOut
}) => {
  
  const CommunityItem = ({ community }) => (
    <div
      onClick={() => setSelectedCommunityId(community.id)}
      className={`px-4 py-3 cursor-pointer transition-colors flex items-center gap-3 ${
        selectedCommunityId === community.id
          ? 'bg-indigo-600 text-white font-semibold rounded-md shadow-lg'
          : 'text-indigo-200 hover:bg-indigo-700 hover:text-white rounded-md'
      }`}
    >
      <Users size={16} />
      {community.name}
    </div>
  );

  const NavItem = ({ label, icon: Icon, targetView }) => (
    <div
      onClick={() => setView(targetView)}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors rounded-md ${
        view === targetView
          ? 'bg-indigo-600 text-white font-semibold shadow-lg'
          : 'text-indigo-200 hover:bg-indigo-700 hover:text-white'
      }`}
    >
      <Icon size={16} />
      {label}
    </div>
  );

  return (
    <div className="bg-indigo-800 text-white w-64 flex flex-col h-full p-4 shadow-2xl">
      <h1 className="text-2xl font-extrabold mb-8 text-center tracking-wider border-b border-indigo-700 pb-3">LeDo</h1>
      
      <div className="space-y-2 mb-8">
        <NavItem label="Today's Things" icon={Clock} targetView="tasks" />
        <NavItem label="AI Strategist Chat" icon={MessageSquare} targetView="chat" />
        <NavItem label="History Log" icon={BarChart2} targetView="history" />
        <NavItem label="Settings" icon={Settings} targetView="settings" />
      </div>

      <div className="flex-grow overflow-y-auto space-y-2">
        <h2 className="text-sm font-bold text-indigo-300 uppercase mb-2 ml-1">Communities</h2>
        {communities.map(community => (
          <CommunityItem key={community.id} community={community} />
        ))}
      </div>
      
      <div className="mt-4 pt-4 border-t border-indigo-700">
        <p className="text-xs text-indigo-400 mb-2">User ID (Share this to connect):</p>
        <p className="text-sm font-mono truncate bg-indigo-900 p-2 rounded-md">{userId || 'Loading...'}</p>
        <button
          onClick={handleSignOut}
          className="w-full mt-4 flex items-center justify-center gap-2 py-2 px-4 bg-indigo-700 hover:bg-red-600 text-white font-semibold rounded-lg transition-colors"
        >
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  );
};

// --- Component: TaskForm Modal ---

const TaskFormModal = ({ db, currentCommunity, taskToEdit, onClose }) => {
  const [taskName, setTaskName] = useState(taskToEdit?.name || '');
  const [assignee, setAssignee] = useState(taskToEdit?.assignee || currentCommunity.members[0]?.name || '');
  const [deadline, setDeadline] = useState(
    taskToEdit?.deadline?.toDate()?.toISOString().substring(0, 10) || ''
  );
  const [status, setStatus] = useState(taskToEdit?.status || 'Processing');
  const [notes, setNotes] = useState(taskToEdit?.notes || '');
  const [isLoading, setIsLoading] = useState(false);
  const isEditing = !!taskToEdit;

  const members = useMemo(() => currentCommunity.members || [], [currentCommunity]);
  const statusOptions = ['Todo', 'Processing', 'Done'];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!db || !currentCommunity.id || !taskName.trim()) return;

    setIsLoading(true);

    const taskData = {
      name: taskName.trim(),
      communityId: currentCommunity.id,
      assignee,
      deadline: deadline ? new Date(deadline) : null,
      status,
      notes,
      isCompleted: status === 'Done',
      updatedAt: serverTimestamp(),
      ...(status === 'Done' && { completedAt: taskToEdit?.completedAt || serverTimestamp() }),
    };

    try {
      if (isEditing) {
        // Update existing task
        await updateDoc(doc(db, `/artifacts/${appId}/public/data/tasks`, taskToEdit.id), taskData);
      } else {
        // Add new task
        await addDoc(collection(db, `/artifacts/${appId}/public/data/tasks`), {
          ...taskData,
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (error) {
      console.error("Error saving task:", error);
      // Replaced alert with console error as per guidelines
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-6 border-b pb-3">
          <h2 className="text-2xl font-bold text-gray-800">{isEditing ? 'Edit Task' : 'Add New Task'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Task Name</label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              required
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Assignee</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                required
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              >
                {members.map((member, index) => (
                  <option key={index} value={member.name}>{member.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                required
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              >
                {statusOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows="3"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
            ></textarea>
          </div>

          <div className="flex justify-end pt-4 space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading && <Loader size={18} className="animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// --- Component: Today's Tasks View ---

const TasksView = ({ db, community, tasks, openTaskModal }) => {
  const incompleteTasks = tasks.filter(t => t.status !== 'Done');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState(null);

  const deleteTask = useCallback(async (taskId) => {
    if (!db || !taskId) return;
    try {
      await deleteDoc(doc(db, `/artifacts/${appId}/public/data/tasks`, taskId));
      console.log(`Task ${taskId} deleted.`);
    } catch (error) {
      console.error("Error deleting task:", error);
      // Replaced alert with console error as per guidelines
    } finally {
      setShowDeleteModal(false);
      setTaskToDelete(null);
    }
  }, [db]);
  
  const confirmDelete = (task) => {
    setTaskToDelete(task);
    setShowDeleteModal(true);
  }

  const handleStatusChange = async (task, newStatus) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, `/artifacts/${appId}/public/data/tasks`, task.id), {
        status: newStatus,
        isCompleted: newStatus === 'Done',
        ...(newStatus === 'Done' && { completedAt: serverTimestamp() }),
        ...(newStatus !== 'Done' && { completedAt: null }),
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const TaskCard = ({ task }) => {
    const isOverdue = task.deadline && task.status !== 'Done' && task.deadline.toDate() < new Date();
    const statusClass = getStatusColor(task.status);

    return (
      <div className="bg-white p-4 rounded-xl shadow-lg border border-gray-100 transition-all hover:shadow-xl relative">
        {isOverdue && (
          <div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-semibold px-2 py-1 rounded-bl-lg rounded-tr-xl flex items-center">
            <AlertTriangle size={12} className="mr-1" /> OVERDUE
          </div>
        )}
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-bold text-gray-800 pr-10">{task.name}</h3>
          <div className="flex space-x-2">
            <button onClick={() => openTaskModal(task)} className="text-indigo-500 hover:text-indigo-700 p-1">
              <Edit size={18} />
            </button>
            <button onClick={() => confirmDelete(task)} className="text-red-500 hover:text-red-700 p-1">
              <Trash2 size={18} />
            </button>
          </div>
        </div>
        
        <p className="text-sm text-gray-600 mb-3">
          <span className="font-semibold">Assigned to:</span> {task.assignee}
        </p>

        <div className="flex justify-between items-center text-sm">
          <span className={`px-3 py-1 text-xs font-semibold rounded-full ${statusClass}`}>
            {task.status}
          </span>
          <span className="flex items-center text-gray-500">
            <Calendar size={14} className="mr-1" />
            {task.deadline ? formatTimestamp(task.deadline) : 'No Deadline'}
          </span>
        </div>
        
        {task.status !== 'Done' && (
          <button 
            onClick={() => handleStatusChange(task, 'Done')}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 text-sm bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors shadow-md"
          >
            <CheckCircle size={16} /> Mark as Done
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-extrabold text-gray-900">
          {community.name} - Today's Things ({incompleteTasks.length})
        </h2>
        <button
          onClick={() => openTaskModal(null)}
          className="flex items-center gap-2 py-2 px-4 bg-indigo-600 text-white font-semibold rounded-full shadow-lg hover:bg-indigo-700 transition-colors transform hover:scale-105"
        >
          <Plus size={20} /> New Task
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {incompleteTasks.length > 0 ? (
          incompleteTasks.map(task => <TaskCard key={task.id} task={task} />)
        ) : (
          <div className="col-span-full bg-indigo-50 p-6 rounded-xl text-center text-gray-600 border-2 border-dashed border-indigo-200">
            <CheckCircle size={32} className="mx-auto text-indigo-400 mb-2" />
            <p className="font-semibold text-lg">All caught up!</p>
            <p>You have no pending tasks in {community.name}. Go ahead and add one!</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && taskToDelete && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center">
              <Trash2 size={48} className="text-red-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">Confirm Deletion</h3>
              <p className="mb-6 text-gray-600">Are you sure you want to delete the task: **{taskToDelete.name}**? This cannot be undone.</p>
              <div className="flex justify-center space-x-4">
                <button
                  onClick={() => { setShowDeleteModal(false); setTaskToDelete(null); }}
                  className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteTask(taskToDelete.id)}
                  className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete Permanently
                </button>
              </div>
            </div>
         </div>
      )}
    </div>
  );
};


// --- Component: History Log View ---

const HistoryView = ({ tasks }) => {
  const completedTasks = tasks
    .filter(t => t.isCompleted)
    .sort((a, b) => b.completedAt?.toMillis() - a.completedAt?.toMillis());

  // Group by completion date
  const groupedTasks = completedTasks.reduce((acc, task) => {
    const dateKey = formatTimestamp(task.completedAt);
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(task);
    return acc;
  }, {});

  return (
    <div className="p-8 h-full overflow-y-auto">
      <h2 className="text-3xl font-extrabold text-gray-900 mb-6 flex items-center gap-2">
        <BarChart2 size={28} /> Task Completion History
      </h2>
      
      {Object.entries(groupedTasks).length === 0 ? (
        <div className="bg-gray-50 p-6 rounded-xl text-center text-gray-600 border-2 border-dashed border-gray-200 mt-8">
          <Clock size={32} className="mx-auto text-gray-400 mb-2" />
          <p className="font-semibold text-lg">No Completed Tasks Yet</p>
          <p>Get started by marking some tasks as "Done"!</p>
        </div>
      ) : (
        Object.entries(groupedTasks).map(([date, tasks]) => (
          <div key={date} className="mb-8">
            <h3 className="text-xl font-bold text-indigo-700 mb-4 border-b pb-2">{date}</h3>
            <div className="space-y-3">
              {tasks.map(task => (
                <div key={task.id} className="bg-white p-4 rounded-lg shadow-md flex justify-between items-center border-l-4 border-green-500">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{task.name}</p>
                    <p className="text-sm text-gray-500">
                      Completed by {task.assignee} in {tasks.find(c => c.id === task.communityId)?.name || 'Unknown Community'}
                    </p>
                  </div>
                  <div className="text-sm text-green-600 font-bold flex items-center ml-4">
                    <CheckCircle size={16} className="mr-1" /> DONE
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// --- Component: AI Strategist Chat View ---

const ChatView = ({ db, userId, communities, tasks, chatHistory }) => {
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // Memoize data to pass to the AI system
  const communityDataString = useMemo(() => {
    return communities.map(c => 
      `${c.name} (ID: ${c.id}): Members: [${(c.members || []).map(m => m.name).join(', ')}]`
    ).join('; ');
  }, [communities]);

  const taskDataString = useMemo(() => {
    // Only pass relevant, current task data to keep the context focused
    const recentTasks = tasks.filter(t => t.status !== 'Done' || t.completedAt?.toDate() > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)); // Last 30 days
    return recentTasks.map(t => 
      `[${t.status}] Task: ${t.name}, Community: ${communities.find(c => c.id === t.communityId)?.name || 'N/A'}, Assigned: ${t.assignee}, Deadline: ${formatTimestamp(t.deadline)}`
    ).join('\n');
  }, [tasks, communities]);

  // System Instruction tailored for LeDo's strategist persona
  const systemPrompt = `You are LeDo AI Strategist, an expert community manager and creative assistant. Your goal is to help the user grow and manage their communities efficiently.
  
  **Your Persona:** Friendly, strategic, creative, and analytical.
  
  **Your Core Functions:**
  1.  **Event Suggestions/Names:** Generate creative, practical event ideas and names based on the user's request.
  2.  **Activity Analysis:** Analyze the provided Community and Task data to offer insights and improvements.
      - *Example Analysis:* Identify overloaded members, suggest focusing on communities with low activity, or point out missed deadlines.
  
  **CURRENT CONTEXTUAL DATA:**
  - **Available Communities & Members:** ${communityDataString || 'No communities defined.'}
  - **Recent Task Activity (Last 30 Days/Pending):**
  ${taskDataString || 'No recent task data available.'}
  
  Please base your analysis and suggestions primarily on this data. When asked for general concepts (like "creative names for a tech hackathon"), you may use general knowledge. Keep your responses concise and action-oriented.`;

  const saveMessage = async (role, text, sources = []) => {
    if (!db || !userId) return;
    try {
      await addDoc(collection(db, `/artifacts/${appId}/users/${userId}/chat_history`), {
        role,
        text,
        timestamp: serverTimestamp(),
        sources: sources.map(s => ({ uri: s.uri, title: s.title }))
      });
    } catch (error) {
      console.error("Error saving chat message:", error);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const userQuery = input.trim();
    if (!userQuery) return;

    setInput('');
    setIsTyping(true);
    
    // Save user message immediately
    await saveMessage('user', userQuery);

    try {
      // Pass only the last 10 messages of history for context
      const recentHistory = chatHistory.slice(-10); 
      
      const { text: modelResponse, sources } = await callGeminiApi(
        systemPrompt, 
        userQuery, 
        userQuery.toLowerCase().includes('latest news') || userQuery.toLowerCase().includes('what is') || userQuery.toLowerCase().includes('event ideas'), // Use grounding for factual/idea-based queries
        recentHistory
      );
      
      // Save model response
      await saveMessage('model', modelResponse, sources);

    } catch (error) {
      await saveMessage('model', 'An error occurred while connecting to the AI Strategist. Please check your connection and try again.');
    } finally {
      setIsTyping(false);
    }
  };
  
  useEffect(() => {
    // Scroll to the bottom of the chat window when new messages arrive
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }, [chatHistory, isTyping]);


  const ChatBubble = ({ message }) => (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-3/4 p-3 rounded-xl shadow-md ${
        message.role === 'user' 
          ? 'bg-indigo-600 text-white rounded-br-none' 
          : 'bg-gray-100 text-gray-800 rounded-tl-none'
      }`}>
        <p className="whitespace-pre-wrap">{message.text}</p>
        {message.timestamp && (
           <span className="block text-xs mt-1 opacity-75">
             {formatTimestamp(message.timestamp, true)}
           </span>
        )}
      </div>
    </div>
  );
  
  return (
    <div className="flex flex-col h-full p-8 bg-gray-50">
      <h2 className="text-3xl font-extrabold text-gray-900 mb-6 flex items-center gap-2 border-b pb-4">
        <MessageSquare size={28} /> AI Strategist Chat
      </h2>
      
      {/* Chat History Container */}
      <div id="chat-container" className="flex-grow overflow-y-auto mb-6 p-4 bg-white rounded-xl shadow-inner border border-gray-200">
        <div className="text-center text-gray-500 mb-6 border-b pb-4">
          <p className="font-semibold text-indigo-600">LeDo AI Strategist</p>
          <p className="text-sm">I'm here to help you strategize events, name projects, and analyze your community activity!</p>
        </div>
        
        {chatHistory.map(msg => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {isTyping && (
          <div className="flex justify-start mb-4">
             <div className="p-3 rounded-xl shadow-md bg-gray-100 text-gray-800 rounded-tl-none flex items-center space-x-2">
               <Loader size={16} className="animate-spin text-indigo-500" />
               <span>Strategist is typing...</span>
             </div>
          </div>
        )}
      </div>
      
      {/* Input Form */}
      <form onSubmit={handleSend} className="flex gap-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for event ideas, analysis, or project names..."
          disabled={isTyping}
          className="flex-grow p-3 border border-gray-300 rounded-full focus:ring-indigo-500 focus:border-indigo-500 shadow-lg"
        />
        <button
          type="submit"
          disabled={isTyping || !input.trim()}
          className="p-3 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={24} />
        </button>
      </form>
    </div>
  );
};


// --- Component: Settings View ---

const SettingsView = ({ db, userId, communities, tasks, setCommunities }) => {
  const [newCommunityName, setNewCommunityName] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [communityToEdit, setCommunityToEdit] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const addCommunity = async (e) => {
    e.preventDefault();
    if (!db || !newCommunityName.trim()) return;
    setIsLoading(true);

    const defaultMembers = [
        { name: 'Self', role: 'Lead' }, 
        { name: newCommunityName.trim() + ' Member 1', role: 'Member' }
    ];

    try {
      await addDoc(collection(db, `/artifacts/${appId}/public/data/communities`), {
        name: newCommunityName.trim(),
        ownerId: userId,
        members: defaultMembers,
        createdAt: serverTimestamp(),
      });
      setNewCommunityName('');
    } catch (error) {
      console.error("Error creating community:", error);
      // Replaced alert with console error as per guidelines
    } finally {
      setIsLoading(false);
    }
  };
  
  const updateCommunityMembers = async (e) => {
    e.preventDefault();
    if (!db || !communityToEdit) return;
    setIsLoading(true);

    try {
      await updateDoc(doc(db, `/artifacts/${appId}/public/data/communities`, communityToEdit.id), {
        members: communityToEdit.members,
        updatedAt: serverTimestamp(),
      });
      setCommunityToEdit(null); // Close modal
    } catch (error) {
      console.error("Error updating members:", error);
      // Replaced alert with console error as per guidelines
    } finally {
      setIsLoading(false);
    }
  };

  const deleteCommunity = async (communityId) => {
    if (!db || !communityId || !window.confirm("WARNING: Are you absolutely sure you want to delete this community and ALL its associated tasks?")) return;

    try {
      // 1. Delete all associated tasks (Admin-level operation)
      const tasksQuery = query(
        collection(db, `/artifacts/${appId}/public/data/tasks`),
        where('communityId', '==', communityId)
      );
      const taskDocs = await getDocs(tasksQuery);
      const deletePromises = taskDocs.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      // 2. Delete the community document
      await deleteDoc(doc(db, `/artifacts/${appId}/public/data/communities`, communityId));
      
      // Replaced alert with console log as per guidelines
      console.log(`Community and ${taskDocs.docs.length} tasks successfully deleted.`);
    } catch (error) {
      console.error("Error deleting community and tasks:", error);
      // Replaced alert with console error as per guidelines
    }
  };

  const handleAddMember = (e) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;

    setCommunityToEdit(prev => ({
      ...prev,
      members: [
        ...prev.members,
        { name: newMemberName.trim(), role: 'Member', id: crypto.randomUUID() }
      ]
    }));
    setNewMemberName('');
  };
  
  const handleRemoveMember = (id) => {
    setCommunityToEdit(prev => ({
      ...prev,
      members: prev.members.filter(m => m.id !== id)
    }));
  };
  
  return (
    <div className="p-8 h-full overflow-y-auto">
      <h2 className="text-3xl font-extrabold text-gray-900 mb-8 flex items-center gap-2">
        <Settings size={28} /> Application Settings & Management
      </h2>

      {/* Community Creation */}
      <div className="bg-white p-6 rounded-xl shadow-lg mb-8 border border-indigo-100">
        <h3 className="text-xl font-bold text-indigo-700 mb-4">Create New Community</h3>
        <form onSubmit={addCommunity} className="flex gap-4 items-center">
          <input
            type="text"
            value={newCommunityName}
            onChange={(e) => setNewCommunityName(e.target.value)}
            placeholder="E.g., Design Society, Marketing Team"
            required
            className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={isLoading || !newCommunityName.trim()}
            className="flex items-center gap-2 py-3 px-6 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Plus size={20} /> Add Community
          </button>
        </form>
      </div>

      {/* Existing Communities Management */}
      <div className="bg-white p-6 rounded-xl shadow-lg mb-8 border border-gray-200">
        <h3 className="text-xl font-bold text-indigo-700 mb-4">Manage Communities</h3>
        <div className="space-y-4">
          {communities.length === 0 ? (
            <p className="text-gray-500">No communities available. Create one above!</p>
          ) : (
            communities.map(community => (
              <div key={community.id} className="flex justify-between items-center p-3 border-b last:border-b-0">
                <span className="font-semibold text-gray-800">{community.name}</span>
                <div className="flex space-x-3">
                  <button
                    onClick={() => setCommunityToEdit(community)}
                    className="flex items-center text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    <Users size={16} className="mr-1" /> Manage Members
                  </button>
                  <button
                    onClick={() => deleteCommunity(community.id)}
                    className="flex items-center text-sm text-red-600 hover:text-red-800 transition-colors"
                  >
                    <Trash2 size={16} className="mr-1" /> Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Member Management Modal */}
      {communityToEdit && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
              <div className="flex justify-between items-center mb-6 border-b pb-3">
                <h3 className="text-2xl font-bold text-gray-800">Manage Members for {communityToEdit.name}</h3>
                <button onClick={() => setCommunityToEdit(null)} className="text-gray-500 hover:text-gray-800">
                  <X size={24} />
                </button>
              </div>
              
              <div className="space-y-4">
                {/* Add Member Form */}
                <form onSubmit={handleAddMember} className="flex gap-3 mb-4">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="New Member Name"
                    className="flex-grow p-2 border border-gray-300 rounded-lg"
                  />
                  <button type="submit" className="py-2 px-4 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600">
                    Add
                  </button>
                </form>

                {/* Member List */}
                <div className="max-h-60 overflow-y-auto border p-3 rounded-lg bg-gray-50">
                  <p className="font-semibold mb-2">Current Members:</p>
                  {communityToEdit.members.map((member) => (
                    <div key={member.id || member.name} className="flex justify-between items-center py-2 border-b last:border-b-0">
                      <span className="text-gray-700">{member.name}</span>
                      <button
                        onClick={() => handleRemoveMember(member.id || member.name)}
                        disabled={member.name === 'Self'} // Prevent removing the mandatory 'Self' member
                        className="text-red-500 hover:text-red-700 disabled:opacity-30"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={updateCommunityMembers}
                  disabled={isLoading}
                  className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Saving...' : 'Save Member List'}
                </button>
              </div>
            </div>
         </div>
      )}

    </div>
  );
};


// --- Main Application Component ---

const App = () => {
  const { db, userId, isAuthReady, handleSignOut } = useFirebase();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [view, setView] = useState('tasks'); // 'tasks', 'chat', 'history', 'settings'
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState(null);
  
  // State for in-app alerts
  const [alerts, setAlerts] = useState([]);
  
  // Data from Firestore
  const communities = usePublicCollection(db, isAuthReady, 'communities');
  const tasks = usePublicCollection(db, isAuthReady, 'tasks');
  const chatHistory = usePrivateChatHistory(db, isAuthReady, userId);

  // Default to the first available community ID or null
  const [selectedCommunityId, setSelectedCommunityId] = useState(null);
  
  // Logic to check for alerts (Deadlines and Pending Work)
  const checkAlerts = useCallback(() => {
    if (!tasks.length || communities.length === 0) {
      setAlerts([]);
      return;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const newAlerts = [];

    tasks.forEach(task => {
      const communityName = communities.find(c => c.id === task.communityId)?.name || 'Unknown Community';

      // 1. Check Deadline Alerts (Today or Tomorrow)
      if (task.status !== 'Done' && task.deadline?.toDate) {
        const deadlineDate = task.deadline.toDate();
        deadlineDate.setHours(0, 0, 0, 0);

        const daysDiff = (deadlineDate.getTime() - today.getTime()) / (1000 * 3600 * 24);

        if (daysDiff === 1) {
          // One Day Before Alert
          newAlerts.push({ 
            id: `${task.id}-tomorrow`,
            message: `⏰ **Upcoming Deadline:** Task "<strong>${task.name}</strong>" in ${communityName} is due tomorrow.`,
            type: 'warning' 
          });
        } else if (daysDiff === 0) {
          // Due Today Alert
          newAlerts.push({ 
            id: `${task.id}-today`,
            message: `🚨 **DUE TODAY!** Task "<strong>${task.name}</strong>" in ${communityName} must be completed today.`,
            type: 'danger' 
          });
        }
      }
      
      // 2. Check for "Todo" status (General Pending Work Alert)
      if (task.status === 'Todo') {
           newAlerts.push({
              id: `${task.id}-todo`,
              message: `📌 **Pending Work:** Task "<strong>${task.name}</strong>" in ${communityName} is marked as 'Todo'. Consider starting or re-assigning.`,
              type: 'info'
           });
      }
    });

    // Simple deduplication based on ID
    const uniqueAlerts = Array.from(new Map(newAlerts.map(a => [a.id, a])).values());
    setAlerts(uniqueAlerts);
  }, [tasks, communities]);

  useEffect(() => {
    // Run check when tasks or communities change
    checkAlerts();
  }, [checkAlerts]);
  
  const handleCloseAlerts = () => {
    setAlerts([]);
  };

  // Update selected community when communities load
  useEffect(() => {
    if (communities.length > 0 && !selectedCommunityId) {
      setSelectedCommunityId(communities[0].id);
    } else if (communities.length > 0 && selectedCommunityId && !communities.find(c => c.id === selectedCommunityId)) {
       // Fallback if the selected community was deleted
       setSelectedCommunityId(communities[0].id);
    }
  }, [communities, selectedCommunityId]);

  // Derived state for the currently selected community
  const currentCommunity = useMemo(() => 
    communities.find(c => c.id === selectedCommunityId) || { id: null, name: 'Loading...', members: [] }
  , [communities, selectedCommunityId]);
  
  // Derived state for tasks relevant to the selected community
  const communityTasks = useMemo(() => 
    tasks.filter(t => t.communityId === selectedCommunityId)
  , [tasks, selectedCommunityId]);

  const openTaskModal = (task = null) => {
    setTaskToEdit(task);
    setShowTaskModal(true);
  };
  
  if (!isAuthReady || !db || !userId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="flex items-center space-x-3 text-2xl text-indigo-600">
          <Loader size={32} className="animate-spin" />
          <span>Setting up LeDo...</span>
        </div>
      </div>
    );
  }
  
  if (communities.length === 0 && view !== 'settings') {
     return (
       <div className="flex flex-col items-center justify-center min-h-screen bg-indigo-50 p-8">
         <div className="text-center bg-white p-10 rounded-xl shadow-2xl max-w-lg border border-indigo-200">
           <h1 className="text-3xl font-extrabold text-indigo-700 mb-4">Welcome to LeDo</h1>
           <p className="text-gray-600 mb-6">
             You need to create at least one community to get started. All your data will be stored securely in the cloud.
           </p>
           <button
             onClick={() => setView('settings')}
             className="flex items-center mx-auto gap-2 py-3 px-6 bg-indigo-600 text-white font-semibold rounded-lg shadow-lg hover:bg-indigo-700 transition-colors transform hover:scale-105"
           >
             <Plus size={20} /> Create First Community
           </button>
         </div>
         <p className="mt-4 text-xs text-gray-500">Your ID: {userId}</p>
       </div>
     );
  }


  const renderContent = () => {
    switch (view) {
      case 'tasks':
        return <TasksView db={db} community={currentCommunity} tasks={communityTasks} openTaskModal={openTaskModal} />;
      case 'chat':
        return <ChatView db={db} userId={userId} communities={communities} tasks={tasks} chatHistory={chatHistory} />;
      case 'history':
        return <HistoryView tasks={tasks} />;
      case 'settings':
        return <SettingsView db={db} userId={userId} communities={communities} setCommunities={setSelectedCommunityId} />;
      default:
        return <div className="p-8">Select an option from the sidebar.</div>;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden antialiased">
      {/* Alert Banner */}
      <AlertBanner alerts={alerts} onClose={handleCloseAlerts} />

      {/* Sidebar (Desktop) */}
      <div className="hidden md:flex flex-shrink-0">
        <Sidebar 
          communities={communities} 
          selectedCommunityId={selectedCommunityId} 
          setSelectedCommunityId={setSelectedCommunityId} 
          view={view} 
          setView={setView} 
          userId={userId} 
          handleSignOut={handleSignOut}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black opacity-50" onClick={() => setIsSidebarOpen(false)}></div>
          <div className="relative h-full">
            <Sidebar 
              communities={communities} 
              selectedCommunityId={selectedCommunityId} 
              setSelectedCommunityId={setSelectedCommunityId} 
              view={view} 
              setView={(v) => { setView(v); setIsSidebarOpen(false); }}
              userId={userId} 
              handleSignOut={handleSignOut}
            />
            <button
              className="absolute top-4 right-4 text-white bg-indigo-800 p-2 rounded-full"
              onClick={() => setIsSidebarOpen(false)}
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
        {/* Header for Mobile */}
        <header className="md:hidden p-4 bg-white shadow-md flex items-center justify-between">
          <button onClick={() => setIsSidebarOpen(true)} className="text-indigo-600">
            <Menu size={24} />
          </button>
          <h1 className="text-lg font-bold text-gray-800">LeDo - {view.charAt(0).toUpperCase() + view.slice(1)}</h1>
          <div className="w-6"></div> {/* Placeholder for balance */}
        </header>

        <main className="flex-1 overflow-y-auto" style={{ paddingTop: alerts.length > 0 ? '72px' : '0' }}>
          {renderContent()}
        </main>
      </div>
      
      {/* Task Modal */}
      {showTaskModal && (
        <TaskFormModal 
          db={db} 
          currentCommunity={currentCommunity} 
          taskToEdit={taskToEdit} 
          onClose={() => setShowTaskModal(false)}
        />
      )}
    </div>
  );
};

export default App;
