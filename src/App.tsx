import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Shield, Users, Send, LogOut, Loader2, Lock, ChevronRight, Hash, Sun, Moon, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, db, loginWithGoogle, onAuthStateChanged,
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, limit, serverTimestamp, arrayUnion
} from './firebase';

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
}

export default function App() {
  const [user, setUser] = useState<{ uid: string; isGuest: boolean } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [view, setView] = useState<View>('home');
  const [onlineCount, setOnlineCount] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser({ uid: u.uid, isGuest: false });
        setIsAuthLoading(false);
      } else {
        let guestId = sessionStorage.getItem('chat_guest_id');
        if (!guestId) {
          guestId = 'guest_' + Math.random().toString(36).substring(2, 15);
          sessionStorage.setItem('chat_guest_id', guestId);
        }
        setUser({ uid: guestId, isGuest: true });
        setIsAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Online Count & Heartbeat (Vercel Friendly)
  useEffect(() => {
    if (!user) return;
    const heartbeat = () => {
      setDoc(doc(db, 'online_users', user.uid), { lastActive: serverTimestamp() }).catch(() => {});
    };
    heartbeat();
    const interval = setInterval(heartbeat, 30000);
    const q = query(collection(db, 'online_users'), limit(100));
    const unsubscribe = onSnapshot(q, (snap) => setOnlineCount(snap.size || 1));
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [user]);

  // Matching & Chat Listener (The "Handshake" Logic)
  useEffect(() => {
    if (!user || view !== 'matching') return;

    // 1. Listen for rooms I'm in
    const chatQuery = query(
      collection(db, 'chats'),
      where('users', 'array-contains', user.uid),
      where('status', '==', 'active'),
      limit(1)
    );

    const unsubscribeChat = onSnapshot(chatQuery, (snapshot) => {
      if (!snapshot.empty) {
        const chatDoc = snapshot.docs[0];
        setRoomId(chatDoc.id);
        setView('chat');
        deleteDoc(doc(db, 'queue', user.uid)).catch(() => {});
      }
    });

    // 2. Look for others in the queue
    const queueQuery = query(collection(db, 'queue'), limit(10));
    const unsubscribeQueue = onSnapshot(queueQuery, async (snapshot) => {
      const others = snapshot.docs.filter(d => d.id !== user.uid);
      if (others.length > 0) {
        const partnerUid = others[0].id;
        // Stable tie-breaker: smaller UID creates the room
        if (user.uid < partnerUid) {
          const newRoomId = `room_${[user.uid, partnerUid].sort().join('_').substring(0, 20)}`;
          await setDoc(doc(db, 'chats', newRoomId), {
            roomId: newRoomId,
            users: [user.uid, partnerUid],
            messages: [],
            status: 'active',
            createdAt: serverTimestamp()
          }, { merge: true });
        }
      }
    });

    return () => {
      unsubscribeChat();
      unsubscribeQueue();
    };
  }, [user, view]);

  // Active Chat Listener
  useEffect(() => {
    if (!user || !roomId || view !== 'chat') return;
    const unsubscribe = onSnapshot(doc(db, 'chats', roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as ChatSession;
        if (data.status === 'ended') {
          setView('home');
          setRoomId(null);
        } else {
          setMessages(data.messages || []);
        }
      }
    });
    return () => unsubscribe();
  }, [user, roomId, view]);

  // Theme & Scroll
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStartMatching = async () => {
    if (!user) return;
    setView('matching');
    await setDoc(doc(db, 'queue', user.uid), { uid: user.uid, timestamp: serverTimestamp() });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user && roomId && inputText.trim()) {
      const msg: Message = {
        id: Math.random().toString(36).substring(7),
        sender: user.uid,
        text: inputText,
        timestamp: new Date().toISOString()
      };
      await updateDoc(doc(db, 'chats', roomId), { messages: arrayUnion(msg) });
      setInputText('');
    }
  };

  const handleLeaveChat = async () => {
    if (roomId) {
      await updateDoc(doc(db, 'chats', roomId), { status: 'ended' });
      setView('home');
      setRoomId(null);
    }
  };

  const handleCancelMatching = async () => {
    if (user) {
      await deleteDoc(doc(db, 'queue', user.uid));
      setView('home');
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
              onClick={handleCancelMatching}
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
      </AnimatePresence>
    </div>
  );
}
