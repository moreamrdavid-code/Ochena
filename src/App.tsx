import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Shield, Users, Send, LogOut, Loader2, Lock, ChevronRight, Hash, Sun, Moon, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, db, loginAnonymously, loginWithGoogle, onAuthStateChanged,
  collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, getDocs, serverTimestamp, arrayUnion, Timestamp
} from './firebase';
import { User } from 'firebase/auth';

type View = 'home' | 'gender_select' | 'matching' | 'chat' | 'admin_login' | 'admin_panel';
type Gender = 'male' | 'female';

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
}

interface ChatSession {
  roomId: string;
  users: string[];
  messages: Message[];
  status: 'active' | 'ended';
  createdAt: any;
  endedAt?: any;
}

export default function App() {
  const [user, setUser] = useState<{ uid: string; isGuest: boolean } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [view, setView] = useState<View>('home');
  const [onlineCount, setOnlineCount] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [adminData, setAdminData] = useState<{ active: { [key: string]: ChatSession }, history: ChatSession[] }>({ active: {}, history: [] });
  const [adminTab, setAdminTab] = useState<'active' | 'history'>('active');
  const [selectedAdminChat, setSelectedAdminChat] = useState<string | null>(null);
  const selectedAdminChatRef = useRef<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const matchingInterval = useRef<any>(null);

  useEffect(() => {
    selectedAdminChatRef.current = selectedAdminChat;
  }, [selectedAdminChat]);

  // Auth & Guest Session Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser({ uid: u.uid, isGuest: false });
        setIsAuthLoading(false);
      } else {
        // Check for existing guest ID in localStorage
        let guestId = localStorage.getItem('chat_guest_id');
        if (!guestId) {
          guestId = 'guest_' + Math.random().toString(36).substring(2, 15);
          localStorage.setItem('chat_guest_id', guestId);
        }
        setUser({ uid: guestId, isGuest: true });
        setIsAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Online Count & Heartbeat
  useEffect(() => {
    if (!user) return;

    // Set heartbeat
    const heartbeat = async () => {
      try {
        await setDoc(doc(db, 'online_users', user.uid), {
          lastActive: serverTimestamp()
        });
      } catch (e) { console.error("Heartbeat error:", e); }
    };
    heartbeat();
    const interval = setInterval(heartbeat, 30000); // Every 30s

    // Listen to online count - only count users active in the last 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 120000);
    const q = query(
      collection(db, 'online_users'),
      where('lastActive', '>=', twoMinutesAgo)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOnlineCount(snapshot.size || 1);
    }, (err) => {
      console.error("Online count error:", err);
      // Fallback to simple count if query fails due to missing index
      const simpleQ = query(collection(db, 'online_users'));
      onSnapshot(simpleQ, (s) => setOnlineCount(s.size));
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [user]);

  // Theme & Scroll
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Matching & Chat Listener
  useEffect(() => {
    if (!user || view !== 'matching') return;

    // Listen for chats I'm invited to
    const q = query(
      collection(db, 'chats'),
      where('users', 'array-contains', user.uid),
      where('status', '==', 'active'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const chatDoc = snapshot.docs[0];
        const data = chatDoc.data() as ChatSession;
        setRoomId(chatDoc.id);
        setMessages(data.messages || []);
        setView('chat');
        // Remove from queue
        deleteDoc(doc(db, 'queue', user.uid)).catch(console.error);
      }
    }, (err) => console.error("Chat listener error:", err));

    // Try to find someone in the queue
    const tryMatch = async () => {
      try {
        const queueQuery = query(
          collection(db, 'queue'),
          orderBy('timestamp', 'asc'),
          limit(10)
        );
        const queueSnap = await getDocs(queueQuery);
        const others = queueSnap.docs.filter(d => d.id !== user.uid);
        
        if (others.length > 0) {
          const partner = others[0].data();
          const newRoomId = `room_${Math.random().toString(36).substring(7)}`;
          
          // Use a transaction or a specific check to avoid double matching
          // For simplicity in this anonymous app, we'll just try to create the chat
          // and the first one to succeed wins.
          
          await setDoc(doc(db, 'chats', newRoomId), {
            roomId: newRoomId,
            users: [user.uid, partner.uid],
            messages: [],
            status: 'active',
            createdAt: serverTimestamp()
          });

          // Cleanup Queue
          await deleteDoc(doc(db, 'queue', user.uid));
          await deleteDoc(doc(db, 'queue', partner.uid));
        }
      } catch (e) {
        console.error("Matching error:", e);
      }
    };

    const matchInterval = setInterval(tryMatch, 3000);
    return () => {
      unsubscribe();
      clearInterval(matchInterval);
    };
  }, [user, view]);

  // Active Chat Listener
  useEffect(() => {
    if (!user || !roomId || view !== 'chat') return;

    const unsubscribe = onSnapshot(doc(db, 'chats', roomId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as ChatSession;
        if (data.status === 'ended') {
          setView('home');
          setRoomId(null);
          return;
        }
        setMessages(data.messages || []);
      } else {
        setView('home');
        setRoomId(null);
      }
    }, (err) => console.error("Active chat error:", err));

    return () => unsubscribe();
  }, [user, roomId, view]);

  // Admin Panel Listener
  useEffect(() => {
    if (view !== 'admin_panel') return;

    const q = query(collection(db, 'chats'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const active: { [key: string]: ChatSession } = {};
      const history: ChatSession[] = [];

      snapshot.docs.forEach(d => {
        const data = d.data() as ChatSession;
        if (data.status === 'active') {
          active[d.id] = data;
        } else {
          history.push(data);
        }
      });

      setAdminData({ active, history });
    }, (err) => console.error("Admin listener error:", err));

    return () => unsubscribe();
  }, [view]);

  const handleStartMatching = async () => {
    if (!user) return;
    
    try {
      setView('matching');
      await setDoc(doc(db, 'queue', user.uid), {
        uid: user.uid,
        timestamp: serverTimestamp()
      });
    } catch (e) {
      console.error("Queue error:", e);
      alert("ম্যাচিং শুরু করা যাচ্ছে না। দয়া করে আবার চেষ্টা করুন।");
      setView('home');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user && roomId && inputText.trim()) {
      const newMessage: Message = {
        id: Math.random().toString(36).substring(7),
        sender: user.uid,
        text: inputText,
        timestamp: new Date().toISOString()
      };
      await updateDoc(doc(db, 'chats', roomId), {
        messages: arrayUnion(newMessage)
      });
      setInputText('');
    }
  };

  const handleLeaveChat = async () => {
    if (roomId) {
      await updateDoc(doc(db, 'chats', roomId), {
        status: 'ended',
        endedAt: serverTimestamp()
      });
      setView('home');
      setRoomId(null);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await loginWithGoogle();
      if (result.user.email === "ridoymostofa.1@gmail.com") {
        setView('admin_panel');
      } else {
        alert('আপনি অ্যাডমিন নন।');
        await auth.signOut();
      }
    } catch (error) {
      console.error(error);
      alert('লগইন ব্যর্থ হয়েছে।');
    }
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="min-h-screen bg-bg text-accent font-sans selection:bg-primary selection:text-white overflow-hidden transition-colors duration-300">
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/10 blur-[120px] rounded-full" />
      </div>

      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="fixed top-6 right-6 z-50 p-3 glass rounded-full hover:scale-110 transition-all active:scale-95"
      >
        {theme === 'dark' ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-indigo-600" />}
      </button>

      <AnimatePresence mode="wait">
        {view === 'home' && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative flex flex-col items-center justify-center min-h-screen p-6"
          >
            <div className="w-full max-w-lg space-y-12 text-center">
              <div className="space-y-4">
                <motion.h1 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-7xl md:text-8xl font-bold tracking-tighter font-serif italic bg-clip-text text-transparent bg-gradient-to-br from-accent to-muted"
                >
                  অচেনা
                </motion.h1>
                <motion.p 
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-base md:text-lg font-medium text-muted"
                >
                  গল্প করো অচেনা হয়ে, কেউ জানবে না
                </motion.p>
              </div>

              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="space-y-10"
              >
                <button
                  onClick={handleStartMatching}
                  disabled={isAuthLoading}
                  className="btn-vibrant px-12 py-6 text-white rounded-full text-2xl font-bold uppercase tracking-tighter shadow-2xl disabled:opacity-50"
                >
                  <span className="relative z-10 flex items-center gap-3">
                    {isAuthLoading ? "অপেক্ষা করুন..." : "চ্যাট শুরু করুন"} <ChevronRight size={28} />
                  </span>
                </button>

                <div className="flex items-center justify-center gap-4 px-6 py-3 glass rounded-full w-fit mx-auto">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-mono tracking-widest uppercase text-muted">
                      {onlineCount} জন অনলাইনে আছেন
                    </span>
                  </div>
                </div>
              </motion.div>

              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.2em] text-muted/50 font-medium whitespace-nowrap">
                This app made by "The Daily ICD"
              </div>

              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.3 }}
                whileHover={{ opacity: 1 }}
                onClick={() => setView('admin_login')}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] font-bold"
              >
                অ্যাডমিন প্যানেল
              </motion.button>
            </div>
          </motion.div>
        )}

        {view === 'matching' && (
          <motion.div
            key="matching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-screen p-6 text-center"
          >
            <div className="relative w-32 h-32 mb-12">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 border-t-2 border-primary rounded-full opacity-20"
              />
              <motion.div 
                animate={{ rotate: -360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-4 border-b-2 border-secondary rounded-full opacity-40"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Users className="w-8 h-8 opacity-50" />
              </div>
            </div>
            <h2 className="text-3xl font-serif italic mb-4">কাউকে খোঁজা হচ্ছে...</h2>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">অচেনা বন্ধুর সাথে সংযোগ করা হচ্ছে</p>
            <button
              onClick={async () => { 
                if (user) await deleteDoc(doc(db, 'queue', user.uid));
                setView('home'); 
              }}
              className="mt-16 text-[10px] uppercase tracking-[0.3em] border-b border-muted pb-1 text-muted hover:text-accent hover:border-accent transition-all"
            >
              খোঁজা বন্ধ করুন
            </button>
          </motion.div>
        )}

        {view === 'chat' && (
          <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col h-screen max-w-4xl mx-auto w-full border-x border-white/5"
          >
            <header className="flex items-center justify-between p-6 glass border-b border-white/5 sticky top-0 z-20">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full glass flex items-center justify-center">
                  <Hash size={18} className="opacity-50" />
                </div>
                <div>
                  <h3 className="font-serif italic text-lg leading-tight">অচেনা বন্ধু</h3>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-500 font-bold">সংযুক্ত</p>
                </div>
              </div>
              <button
                onClick={handleLeaveChat}
                className="p-3 glass rounded-full hover:bg-white/10 transition-colors text-muted hover:text-red-400"
              >
                <LogOut size={20} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
              {messages.map((msg) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id}
                  className={`flex ${msg.sender === user?.uid ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="max-w-[85%] md:max-w-[70%] space-y-1">
                    <div
                      className={`px-5 py-4 rounded-3xl text-sm leading-relaxed ${
                        msg.sender === user?.uid
                          ? 'chat-bubble-user text-white rounded-tr-none shadow-lg'
                          : 'chat-bubble-partner text-accent rounded-tl-none'
                      }`}
                    >
                      {msg.text}
                    </div>
                    <p className={`text-[9px] font-mono opacity-30 ${msg.sender === user?.uid ? 'text-right' : 'text-left'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </motion.div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-4 md:p-6 border-t border-white/5 bg-bg/50 backdrop-blur-xl">
              <div className="flex items-center gap-3 max-w-4xl mx-auto">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="কিছু বলুন..."
                    className="w-full glass rounded-2xl py-4 px-6 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all text-sm md:text-base"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="h-[52px] w-[52px] md:h-[60px] md:w-[60px] btn-vibrant text-white rounded-2xl flex items-center justify-center disabled:opacity-20 transition-all active:scale-95 shadow-lg shadow-primary/20 shrink-0"
                >
                  <Send size={24} className="md:w-7 md:h-7" />
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {view === 'admin_login' && (
          <motion.div
            key="admin_login"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex flex-col items-center justify-center min-h-screen p-6"
          >
            <div className="w-full max-w-xs space-y-12 text-center">
              <div className="space-y-4">
                <div className="w-16 h-16 glass rounded-3xl flex items-center justify-center mx-auto">
                  <Lock size={24} className="opacity-50" />
                </div>
                <h2 className="text-2xl font-serif italic">অ্যাডমিন লগইন</h2>
                <p className="text-xs text-muted">গুগল দিয়ে লগইন করুন</p>
              </div>
              
              <div className="space-y-4">
                <button
                  onClick={handleAdminLogin}
                  className="w-full py-4 btn-vibrant text-white rounded-xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                >
                  গুগল দিয়ে প্রবেশ করুন
                </button>
                <button
                  type="button"
                  onClick={() => setView('home')}
                  className="text-[10px] uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity"
                >
                  হোমে ফিরে যান
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {view === 'admin_panel' && (
          <motion.div
            key="admin_panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-screen overflow-hidden"
          >
            <aside className="w-80 glass border-r border-white/5 flex flex-col">
              <header className="p-8 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif italic text-2xl">অচেনা প্যানেল</h2>
                  <button onClick={() => { auth.signOut(); setView('home'); }} className="text-[10px] uppercase tracking-widest opacity-50 hover:opacity-100">বের হন</button>
                </div>
              </header>
              <div className="flex border-b border-white/5">
                <button 
                  onClick={() => setAdminTab('active')}
                  className={`flex-1 py-4 text-[10px] uppercase tracking-widest font-bold transition-all ${adminTab === 'active' ? 'text-primary border-b-2 border-primary' : 'opacity-30'}`}
                >
                  সক্রিয় ({Object.keys(adminData.active).length})
                </button>
                <button 
                  onClick={() => setAdminTab('history')}
                  className={`flex-1 py-4 text-[10px] uppercase tracking-widest font-bold transition-all ${adminTab === 'history' ? 'text-primary border-b-2 border-primary' : 'opacity-30'}`}
                >
                  ইতিহাস ({adminData.history.length})
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {adminTab === 'active' ? (
                  Object.values(adminData.active).length === 0 ? (
                    <div className="p-12 text-center opacity-20">
                      <p className="text-[10px] uppercase tracking-widest">কোনো সক্রিয় সেশন নেই</p>
                    </div>
                  ) : (
                    (Object.values(adminData.active) as ChatSession[]).map((chat) => (
                      <button
                        key={chat.roomId}
                        onClick={() => setSelectedAdminChat(chat.roomId)}
                        className={`w-full p-5 text-left rounded-2xl transition-all ${
                          selectedAdminChat === chat.roomId ? 'glass bg-primary/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <p className="text-[10px] font-mono mb-2 opacity-50">{chat.roomId}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-widest font-bold text-muted">
                            {chat.messages.length} মেসেজ
                          </span>
                        </div>
                      </button>
                    ))
                  )
                ) : (
                  adminData.history.length === 0 ? (
                    <div className="p-12 text-center opacity-20">
                      <p className="text-[10px] uppercase tracking-widest">কোনো ইতিহাস নেই</p>
                    </div>
                  ) : (
                    adminData.history.map((chat) => (
                      <button
                        key={chat.roomId + Math.random()}
                        onClick={() => setSelectedAdminChat(chat.roomId)}
                        className={`w-full p-5 text-left rounded-2xl transition-all ${
                          selectedAdminChat === chat.roomId ? 'glass bg-primary/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <p className="text-[10px] font-mono mb-2 opacity-50">{chat.roomId}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-widest font-bold text-muted">
                            {chat.messages.length} মেসেজ (শেষ)
                          </span>
                        </div>
                      </button>
                    ))
                  )
                )}
              </div>
            </aside>

            <main className="flex-1 flex flex-col relative">
              {(() => {
                let chat: ChatSession | undefined;
                if (selectedAdminChat?.includes('_hist_')) {
                  const idx = parseInt(selectedAdminChat.split('_hist_')[1]);
                  chat = adminData.history[idx];
                } else if (selectedAdminChat) {
                  chat = adminData.active[selectedAdminChat];
                }

                if (chat) {
                  return (
                    <>
                      <header className="p-8 glass border-b border-white/5">
                        <h3 className="font-serif italic text-xl opacity-50">
                          {selectedAdminChat?.includes('_hist_') ? 'ইতিহাস: ' : 'পর্যবেক্ষণ: '} {chat.roomId}
                        </h3>
                      </header>
                      <div className="flex-1 overflow-y-auto p-8 space-y-8">
                        {chat.messages.map((msg) => (
                          <div key={msg.id} className="space-y-2">
                            <div className="flex items-center gap-3">
                              <span className="text-[9px] font-mono px-2 py-1 glass rounded text-muted">USER_{msg.sender.slice(0, 4)}</span>
                              <span className="text-[8px] font-mono opacity-20">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div className="glass p-5 rounded-2xl max-w-2xl">
                              <p className="text-sm leading-relaxed">{msg.text}</p>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    </>
                  );
                }
                return (
                  <div className="flex-1 flex flex-col items-center justify-center opacity-10">
                    <Shield size={80} strokeWidth={1} />
                    <p className="mt-6 text-[10px] uppercase tracking-[0.4em]">নিরাপদ পর্যবেক্ষণ সক্রিয়</p>
                  </div>
                );
              })()}
            </main>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
