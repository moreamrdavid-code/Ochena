import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Users, Send, LogOut, Hash, Sun, Moon, ChevronRight, User as UserIcon, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from './supabase';

type View = 'home' | 'matching' | 'chat' | 'admin_login';

interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: string;
}

interface ChatSession {
  id: string;
  users: string[];
  status: 'active' | 'ended';
  created_at: string;
}

export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const [onlineCount, setOnlineCount] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize Anonymous User
  useEffect(() => {
    let guestId = sessionStorage.getItem('chat_guest_id');
    if (!guestId) {
      guestId = 'guest_' + Math.random().toString(36).substring(2, 15);
      sessionStorage.setItem('chat_guest_id', guestId);
    }
    setUserId(guestId);
  }, []);

  // Presence & Online Count
  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel('online-users', {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setOnlineCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      channel.unsubscribe();
    };
  }, [userId]);

  // Matching Logic
  useEffect(() => {
    if (!userId || view !== 'matching') return;

    // 1. Listen for chats I'm part of
    const chatChannel = supabase
      .channel('chat-matching')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chats',
          filter: `users=cs.{${userId}}`,
        },
        (payload) => {
          const newChat = payload.new as ChatSession;
          if (newChat.status === 'active') {
            setRoomId(newChat.id);
            setView('chat');
            // Remove from queue
            supabase.from('queue').delete().eq('id', userId).then();
          }
        }
      )
      .subscribe();

    // 2. Look for others in queue and try to pair
    const findMatch = async () => {
      const { data: queueData } = await supabase
        .from('queue')
        .select('id')
        .neq('id', userId)
        .limit(1);

      if (queueData && queueData.length > 0) {
        const partnerId = queueData[0].id;
        const sortedIds = [userId, partnerId].sort();
        const newRoomId = `room_${sortedIds[0].substring(0, 8)}_${sortedIds[1].substring(0, 8)}`;

        // Attempt to create room
        const { error } = await supabase.from('chats').insert({
          id: newRoomId,
          users: sortedIds,
          status: 'active'
        });

        // If successful or if it already exists (someone else created it)
        if (!error || error.code === '23505') { // 23505 is unique violation
          setRoomId(newRoomId);
          setView('chat');
          supabase.from('queue').delete().eq('id', userId).then();
        }
      }
    };

    // Initial check and then listen to queue changes
    findMatch();
    const queueChannel = supabase
      .channel('queue-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'queue' },
        () => findMatch()
      )
      .subscribe();

    return () => {
      chatChannel.unsubscribe();
      queueChannel.unsubscribe();
    };
  }, [userId, view]);

  // Chat Messages Listener
  useEffect(() => {
    if (!roomId || view !== 'chat') return;

    // Fetch existing messages
    supabase
      .from('messages')
      .select('*')
      .eq('chat_id', roomId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) setMessages(data);
      });

    // Listen for new messages
    const msgChannel = supabase
      .channel(`room-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${roomId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chats',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.new.status === 'ended') {
            setView('home');
            setRoomId(null);
          }
        }
      )
      .subscribe();

    return () => {
      msgChannel.unsubscribe();
    };
  }, [roomId, view]);

  // Auto Scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Theme Sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handleStartMatching = async () => {
    if (!userId) return;
    setView('matching');
    await supabase.from('queue').insert({ id: userId });
  };

  const handleCancelMatching = async () => {
    if (userId) {
      await supabase.from('queue').delete().eq('id', userId);
      setView('home');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userId && roomId && inputText.trim()) {
      const text = inputText.trim();
      setInputText('');
      await supabase.from('messages').insert({
        chat_id: roomId,
        sender_id: userId,
        text: text
      });
    }
  };

  const handleLeaveChat = async () => {
    if (roomId) {
      await supabase.from('chats').update({ status: 'ended' }).eq('id', roomId);
      setView('home');
      setRoomId(null);
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
            <div className="w-full max-lg space-y-12 text-center">
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
                  className="btn-vibrant px-12 py-6 text-white rounded-full text-2xl font-bold uppercase tracking-tighter shadow-2xl"
                >
                  <span className="relative z-10 flex items-center gap-3">
                    চ্যাট শুরু করুন <ChevronRight size={28} />
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
                  className={`flex ${msg.sender_id === userId ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="max-w-[85%] md:max-w-[70%] space-y-1">
                    <div
                      className={`px-5 py-4 rounded-3xl text-sm leading-relaxed ${
                        msg.sender_id === userId
                          ? 'chat-bubble-user text-white rounded-tr-none shadow-lg'
                          : 'chat-bubble-partner text-accent rounded-tl-none'
                      }`}
                    >
                      {msg.text}
                    </div>
                    <p className={`text-[9px] font-mono opacity-30 ${msg.sender_id === userId ? 'text-right' : 'text-left'}`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                    placeholder="আপনার মেসেজ লিখুন..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-primary/50 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-primary hover:scale-110 transition-transform disabled:opacity-50"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
