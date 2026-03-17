import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Users, Send, LogOut, Hash, Sun, Moon, ChevronRight, User as UserIcon, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getSupabase } from './supabase';

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
  const [configError, setConfigError] = useState(false);
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

    try {
      const supabase = getSupabase();
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
    } catch (e: any) {
      if (e.message === 'SUPABASE_CONFIG_MISSING') setConfigError(true);
    }
  }, [userId]);

  // Matching Logic
  useEffect(() => {
    if (!userId || view !== 'matching') return;

    try {
      const supabase = getSupabase();
      
      // 1. Listen for chats I'm part of (Simplified filter for better reliability)
      const chatChannel = supabase
        .channel('chat-matching')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chats',
          },
          (payload) => {
            const newChat = payload.new as ChatSession;
            if (newChat.status === 'active' && newChat.users.includes(userId)) {
              setRoomId(newChat.id);
              setView('chat');
              supabase.from('queue').delete().eq('id', userId).then();
            }
          }
        )
        .subscribe();

      // 2. Look for others in queue and try to pair
      const findMatch = async () => {
        // First, check if I'm already matched by someone else
        const { data: existingChat } = await supabase
          .from('chats')
          .select('id')
          .contains('users', [userId])
          .eq('status', 'active')
          .limit(1);

        if (existingChat && existingChat.length > 0) {
          setRoomId(existingChat[0].id);
          setView('chat');
          await supabase.from('queue').delete().eq('id', userId);
          return;
        }

        // Look for someone else in queue
        const { data: queueData } = await supabase
          .from('queue')
          .select('id')
          .neq('id', userId)
          .order('created_at', { ascending: true })
          .limit(1);

        if (queueData && queueData.length > 0) {
          const partnerId = queueData[0].id;
          const sortedIds = [userId, partnerId].sort();
          const newRoomId = `room_${sortedIds[0].substring(0, 8)}_${sortedIds[1].substring(0, 8)}`;

          const { error } = await supabase.from('chats').insert({
            id: newRoomId,
            users: sortedIds,
            status: 'active'
          });

          if (!error || error.code === '23505') {
            setRoomId(newRoomId);
            setView('chat');
            await supabase.from('queue').delete().eq('id', userId);
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
    } catch (e: any) {
      if (e.message === 'SUPABASE_CONFIG_MISSING') setConfigError(true);
    }
  }, [userId, view]);

  // Chat Messages Listener
  useEffect(() => {
    if (!roomId || view !== 'chat') return;

    try {
      const supabase = getSupabase();
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
    } catch (e: any) {
      if (e.message === 'SUPABASE_CONFIG_MISSING') setConfigError(true);
    }
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
    try {
      const supabase = getSupabase();
      setView('matching');
      await supabase.from('queue').insert({ id: userId });
    } catch (e: any) {
      if (e.message === 'SUPABASE_CONFIG_MISSING') setConfigError(true);
    }
  };

  const handleCancelMatching = async () => {
    if (userId) {
      try {
        const supabase = getSupabase();
        await supabase.from('queue').delete().eq('id', userId);
        setView('home');
      } catch (e: any) {
        if (e.message === 'SUPABASE_CONFIG_MISSING') setConfigError(true);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userId && roomId && inputText.trim()) {
      try {
        const supabase = getSupabase();
        const text = inputText.trim();
        setInputText('');
        await supabase.from('messages').insert({
          chat_id: roomId,
          sender_id: userId,
          text: text
        });
      } catch (err: any) {
        if (err.message === 'SUPABASE_CONFIG_MISSING') setConfigError(true);
      }
    }
  };

  const handleLeaveChat = async () => {
    if (roomId) {
      try {
        const supabase = getSupabase();
        await supabase.from('chats').update({ status: 'ended' }).eq('id', roomId);
        setView('home');
        setRoomId(null);
      } catch (e: any) {
        if (e.message === 'SUPABASE_CONFIG_MISSING') setConfigError(true);
      }
    }
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  if (configError) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-6 glass p-8 rounded-3xl border-red-500/20">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
            <Lock className="text-red-500" size={32} />
          </div>
          <h2 className="text-2xl font-serif italic text-accent">Supabase কনফিগারেশন পাওয়া যায়নি</h2>
          <div className="text-muted text-sm space-y-4 leading-relaxed">
            <p>
              আপনি যদি ইতিমধ্যে Secrets যোগ করে থাকেন, তবে নিচের ধাপগুলো চেক করুন:
            </p>
            <ul className="text-left list-disc list-inside space-y-2 opacity-80">
              <li>নামগুলো ঠিক আছে কি না (<b>VITE_SUPABASE_URL</b> এবং <b>VITE_SUPABASE_ANON_KEY</b>)</li>
              <li>কোনো অতিরিক্ত স্পেস (Space) নেই তো?</li>
              <li>Secrets যোগ করার পর <b>Restart Server</b> করেছেন কি না?</li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-primary text-white rounded-xl text-xs uppercase tracking-widest font-bold hover:opacity-90 transition-all"
            >
              পেজ রিফ্রেশ করুন
            </button>
            <p className="text-[10px] text-muted/50 uppercase tracking-tighter">
              রিফ্রেশ করার পরেও না হলে ব্রাউজার কনসোল (F12) চেক করুন।
            </p>
          </div>
        </div>
      </div>
    );
  }

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
        className="fixed top-6 left-6 z-50 p-3 glass rounded-full hover:scale-110 transition-all active:scale-95"
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
            className="fixed inset-0 flex flex-col max-w-4xl mx-auto w-full border-x border-white/5 bg-bg"
          >
            <header className="flex-none flex items-center justify-between p-4 md:p-6 glass border-b border-white/5 z-20">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full glass flex items-center justify-center">
                  <Hash size={18} className="opacity-50" />
                </div>
                <div>
                  <h3 className="font-serif italic text-lg leading-tight">অচেনা বন্ধু</h3>
                  <p className="text-[10px] uppercase tracking-widest text-emerald-500 font-bold">Active</p>
                </div>
              </div>
              <button
                onClick={handleLeaveChat}
                className="p-3 glass rounded-full hover:bg-white/10 transition-colors text-muted hover:text-red-400"
              >
                <LogOut size={20} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 md:space-y-8 scrollbar-hide">
              {messages.map((msg) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id}
                  className={`flex ${msg.sender_id === userId ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="max-w-[85%] md:max-w-[70%] space-y-1">
                    <div
                      className={`px-4 py-3 md:px-5 md:py-4 rounded-2xl md:rounded-3xl text-sm leading-relaxed ${
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

            <form onSubmit={handleSendMessage} className="flex-none p-4 md:p-6 border-t border-white/5 bg-bg/80 backdrop-blur-xl">
              <div className="flex items-center gap-3 max-w-4xl mx-auto">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="আপনার মেসেজ লিখুন..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 md:px-6 md:py-4 text-base focus:outline-none focus:border-primary/50 transition-colors"
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
