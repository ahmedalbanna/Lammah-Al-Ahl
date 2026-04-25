/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, Search, Heart, Phone, MapPin, Mic, Plus, ChevronLeft, LogOut, 
  Bell, CheckCircle2, AlertCircle, Loader2, MessageCircle, Send, X, Shield, Star
} from 'lucide-react';
import { auth, db, loginWithGoogle } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, where, onSnapshot, getDocs, updateDoc, doc, orderBy, setDoc } from 'firebase/firestore';
import { AudioRecorder } from './components/AudioRecorder';
import { transcribeAudio, findMatches } from './lib/gemini';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tab = 'home' | 'register' | 'search' | 'matches' | 'profile' | 'chat' | 'volunteers';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [myMatches, setMyMatches] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  
  // Search Filters
  const [filterConfidence, setFilterConfidence] = useState<number>(0);
  const [filterLocation, setFilterLocation] = useState<string>('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Request notification permission
        if (Notification.permission === 'default') {
          Notification.requestPermission();
        }
      } else {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen to user profile
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setUserProfile(doc.data());
      }
      setLoading(false);
    });

    // Listen to my registrations
    const qReg = query(collection(db, 'registrations'), where('registeredBy', '==', user.uid));
    const unsubReg = onSnapshot(qReg, (snapshot) => {
      setRegistrations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Listen to my reports
    const qRep = query(collection(db, 'reports'), where('registeredBy', '==', user.uid));
    const unsubRep = onSnapshot(qRep, (snapshot) => {
      setReports(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Listen to matches (In a real app, query by seekerUid or registration owner)
    // For simplicity, we fetch all matches where status is pending or confirmed and filter client side
    const qMatches = query(collection(db, 'matches'));
    const unsubMatches = onSnapshot(qMatches, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' && change.doc.data().status === 'pending') {
          if (Notification.permission === 'granted' && change.doc.data().seekerUid === user.uid) {
            new Notification('تطابق جديد محتمل!', { body: 'تم العثور على عائلة قد تطابق بحثك.' });
          }
        }
      });
      setMyMatches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Listen to channels
    const qChannels = query(collection(db, 'channels'), where('participants', 'array-contains', user.uid));
    const unsubChannels = onSnapshot(qChannels, (snapshot) => {
      setChannels(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubProfile();
      unsubReg();
      unsubRep();
      unsubMatches();
      unsubChannels();
    };
  }, [user]);

  const handleRegisterFamily = async (audioBlob: Blob, base64: string) => {
    if (!user) return;
    setIsProcessing(true);
    try {
      const transcription = await transcribeAudio(base64);
      await addDoc(collection(db, 'registrations'), {
        headName: transcription.name || "عائلة مجهولة",
        currentLocation: transcription.location || "غير محدد",
        members: transcription.members || "",
        audioTranscription: transcription.raw || "",
        registeredBy: user.uid,
        createdAt: serverTimestamp(),
      });
      setActiveTab('home');
    } catch (error) {
      console.error("Registration failed", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSearchMissing = async (audioBlob: Blob, base64: string) => {
    if (!user) return;
    setIsProcessing(true);
    try {
      const transcription = await transcribeAudio(base64);
      const reportRef = await addDoc(collection(db, 'reports'), {
        seekerName: user.displayName || "باحث",
        missingPersonDetails: transcription.description || transcription.raw || "",
        audioTranscription: transcription.raw || "",
        registeredBy: user.uid,
        createdAt: serverTimestamp(),
      });

      const allRegsSnapshot = await getDocs(collection(db, 'registrations'));
      const allRegs = allRegsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const potentialMatches = await findMatches(transcription, allRegs);
      
      for (const m of potentialMatches) {
        await addDoc(collection(db, 'matches'), {
          ...m,
          reportId: reportRef.id,
          seekerUid: user.uid,
          createdAt: serverTimestamp(),
          status: 'pending'
        });
      }

      setActiveTab('matches');
    } catch (error) {
      console.error("Search failed", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmMatch = async (matchId: string, registrationUid: string) => {
    if (!user) return;
    // Update match status
    await updateDoc(doc(db, 'matches', matchId), { status: 'confirmed' });
    
    // Create chat channel
    const channelRef = await addDoc(collection(db, 'channels'), {
      matchId,
      participants: [user.uid, registrationUid],
      isAnonymous: true,
      createdAt: serverTimestamp(),
    });
    
    setActiveChannelId(channelRef.id);
    setActiveTab('chat');
  };

  const saveProfile = async (location: string, isVolunteer: boolean) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), {
      userId: user.uid,
      location,
      isVolunteer,
      createdAt: serverTimestamp()
    }, { merge: true });
    alert('تم حفظ الملف الشخصي بنجاح');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F6F1]">
        <Loader2 className="w-10 h-10 text-[#B3543B] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F9F6F1] p-6 text-right font-sans text-[#4A443F]" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full space-y-8 text-center"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-[#B3543B] rounded-[20px] flex items-center justify-center shadow-xl transform -rotate-12">
              <Heart className="w-10 h-10 text-white" />
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-black font-serif text-[#2A2623] tracking-tighter">لمّة الأهل</h1>
            <p className="text-[#7A7169] text-lg leading-relaxed">
              لأن الفقد أقسى من الجوع... منصة تجمع شتات العائلات اليمنية النازحة بكرامة.
            </p>
          </div>
          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white organic-card border-2 border-[#E8E2D9] p-4 font-bold text-[#2A2623] hover:bg-[#FDFBF7] hover:border-[#D9D1C7] transition-all shadow-sm"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
            الدخول عبر جوجل للبدء
          </button>
        </motion.div>
      </div>
    );
  }

  const matchesToShow = myMatches
    .filter(m => m.seekerUid === user.uid)
    .filter(m => m.confidence >= filterConfidence)
    .filter(m => {
      if (!filterLocation) return true;
      const regInfo = registrations.find(r => r.id === m.registrationId);
      return regInfo?.currentLocation?.includes(filterLocation);
    });

  return (
    <div className="min-h-screen bg-[#F9F6F1] font-sans text-[#4A443F] text-right pb-24 flex flex-col" dir="rtl">
      {/* Header */}
      <header className="bg-[#FDFBF7] sticky top-0 z-30 border-b border-[#E8E2D9] px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#B3543B] organic-card flex items-center justify-center shadow-lg">
            <Heart className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold font-serif text-[#2A2623]">لمّة الأهل</h1>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setActiveTab('matches')} className="relative p-2 text-[#7A7169] hover:bg-[#E8E2D9] rounded-full transition-colors">
            <Bell className="w-6 h-6" />
            {myMatches.filter(m => m.status === 'pending').length > 0 && (
              <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
            )}
          </button>
          <button 
            onClick={() => signOut(auth)}
            className="p-2 text-[#7A7169] hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
          >
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto w-full p-6 space-y-8 flex-1">
        <AnimatePresence mode="wait">
          {activeTab === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              {/* Welcome Card */}
              <div className="bg-[#5A5A40] p-8 organic-card text-[#FDFBF7] shadow-xl relative overflow-hidden">
                <div className="relative z-10 space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold font-serif">أهلاً بك يا {user.displayName?.split(' ')[0]}</h2>
                    <p className="opacity-90 text-sm mt-1">نحن هنا لنساعدك في الوصول لأحبابك.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setActiveTab('register')}
                      className="bg-[#ffffff20] backdrop-blur-md p-4 organic-card flex flex-col items-center gap-2 hover:bg-[#ffffff30] transition-colors border border-[#ffffff40]"
                    >
                      <Plus className="w-8 h-8" />
                      <span className="font-bold text-sm text-balance text-center">تسجيل عائلتي</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('search')}
                      className="bg-[#ffffff20] backdrop-blur-md p-4 organic-card flex flex-col items-center gap-2 hover:bg-[#ffffff30] transition-colors border border-[#ffffff40]"
                    >
                      <Search className="w-8 h-8" />
                      <span className="font-bold text-sm text-balance text-center">إضافة بلاغ بحث</span>
                    </button>
                  </div>
                </div>
                <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -mr-24 -mt-24 blur-3xl" />
              </div>

              {/* My Registrations */}
              <section className="space-y-4">
                <h3 className="text-lg font-bold font-serif flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#B3543B]"></span>
                  عائلاتي المسجلة
                </h3>
                {registrations.length === 0 ? (
                  <div className="bg-white p-8 organic-card border-2 border-dashed border-[#E8E2D9] text-center space-y-2">
                    <p className="text-[#7A7169] text-sm">ليس لديك تسجيلات عائلية.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {registrations.map((reg) => (
                      <div key={reg.id} className="bg-white p-4 organic-card shadow-sm border border-[#E8E2D9] flex items-center justify-between">
                        <div>
                          <p className="font-bold font-serif">{reg.headName}</p>
                          <p className="text-xs text-[#7A7169] flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" /> {reg.currentLocation}
                          </p>
                        </div>
                        <CheckCircle2 className="w-6 h-6 text-[#5A5A40]" />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent Active Channels */}
              {channels.length > 0 && (
                <section className="space-y-4">
                  <h3 className="text-lg font-bold font-serif flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#B3543B]"></span>
                    محادثات نشطة
                  </h3>
                  <div className="space-y-3">
                    {channels.map((chan) => (
                      <div key={chan.id} className="bg-[#E8E2D9] p-4 organic-card flex items-center justify-between cursor-pointer hover:bg-[#D9D1C7]" onClick={() => { setActiveChannelId(chan.id); setActiveTab('chat'); }}>
                        <div className="flex items-center gap-3">
                          <MessageCircle className="w-5 h-5 text-[#4A443F]" />
                          <div>
                            <p className="font-bold text-sm">قناة تواصل آمنة</p>
                            <p className="text-xs opacity-70">{chan.isAnonymous ? 'الهوية مخفية' : 'تم كشف الهوية'}</p>
                          </div>
                        </div>
                        <ChevronLeft className="w-5 h-5" />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </motion.div>
          )}

          {activeTab === 'register' && (
            <motion.div
              key="register"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-[#7A7169] hover:text-[#2A2623] transition-colors">
                <ChevronLeft className="w-5 h-5 rotate-180" />
                <span>العودة للرئيسية</span>
              </button>
              <div className="space-y-2">
                <h2 className="text-2xl font-black font-serif">تسجيل العائلة</h2>
                <p className="text-[#7A7169]">سجل بصوتك بيانات عائلتك. اذكر اللقب، القرية، وأسماء الأفراد.</p>
              </div>
              <AudioRecorder onRecordingComplete={handleRegisterFamily} isProcessing={isProcessing} />
            </motion.div>
          )}

          {activeTab === 'search' && (
            <motion.div
              key="search"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-[#7A7169]">
                <ChevronLeft className="w-5 h-5 rotate-180" />
                <span>العودة</span>
              </button>
              <div className="space-y-2">
                <h2 className="text-2xl font-black font-serif">أبحث عن مفقود</h2>
                <p className="text-[#7A7169]">احكِ لنا من تبحث عنه؟ اسمه، عمره، آخر مكان رأيته فيه.</p>
              </div>
              <AudioRecorder onRecordingComplete={handleSearchMissing} isProcessing={isProcessing} />
            </motion.div>
          )}

          {activeTab === 'matches' && (
            <motion.div
              key="matches"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="space-y-2 border-b border-[#E8E2D9] pb-4">
                <h2 className="text-2xl font-black font-serif text-[#2A2623]">تطابقات محتملة</h2>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="text-xs font-bold opacity-70 mb-1 block">نسبة التطابق الدُنيا</label>
                    <select 
                      value={filterConfidence} 
                      onChange={(e) => setFilterConfidence(Number(e.target.value))}
                      className="w-full bg-white border border-[#E8E2D9] p-2 rounded-xl text-sm"
                    >
                      <option value="0">الكل</option>
                      <option value="0.5">50% وأكثر</option>
                      <option value="0.8">80% وأكثر</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold opacity-70 mb-1 block">تصفية بالموقع</label>
                    <input 
                      type="text" 
                      placeholder="مثال: مأرب" 
                      value={filterLocation}
                      onChange={(e) => setFilterLocation(e.target.value)}
                      className="w-full bg-white border border-[#E8E2D9] p-2 rounded-xl text-sm"
                    />
                  </div>
                </div>
              </div>

              {matchesToShow.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 bg-white organic-card border border-[#E8E2D9] text-center space-y-4">
                  <AlertCircle className="w-8 h-8 text-[#D9D1C7]" />
                  <p className="text-[#7A7169]">لا يوجد تطابقات تطابق معايير البحث.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {matchesToShow.map((match) => (
                    <motion.div 
                      key={match.id}
                      className="bg-white p-6 organic-card border border-[#E8E2D9] space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="bg-[#5A5A40] text-[#FDFBF7] px-3 py-1 rounded-full text-xs font-bold">
                          تطابق {Math.round(match.confidence * 100)}%
                        </div>
                        {match.status === 'confirmed' ? (
                          <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-md">مؤكد</span>
                        ) : (
                          <span className="text-xs font-bold opacity-60">قيد الانتظار</span>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <p className="text-[#7A7169] text-xs font-bold uppercase tracking-widest">تفاصيل</p>
                        <p className="text-sm bg-[#F9F6F1] p-4 organic-card border border-[#E8E2D9] italic">
                          "{match.reason}"
                        </p>
                      </div>

                      {match.status === 'pending' && (
                        <div className="flex gap-3">
                          <button 
                            onClick={() => confirmMatch(match.id, 'dummy_uid')} // In real app, pass the registration owner's UID
                            className="flex-1 bg-[#B3543B] text-white font-bold py-3 organic-card hover:opacity-90 transition-colors flex items-center justify-center gap-2"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                            تأكيد أولي والاتصال
                          </button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'chat' && activeChannelId && (
            <ChatView channelId={activeChannelId} onBack={() => setActiveTab('home')} currentUid={user.uid} />
          )}

          {activeTab === 'volunteers' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <h2 className="text-2xl font-black font-serif text-[#2A2623] mb-4">قسم المتطوعين</h2>
              <div className="bg-[#5A5A40] text-white p-6 organic-card space-y-4">
                <Shield className="w-8 h-8 text-[#E8E2D9]" />
                <h3 className="font-bold text-lg">ساعد في لمّ الشمل</h3>
                <p className="text-sm opacity-90 leading-relaxed">
                  بصفتك متطوعاً، ستتمكن من رؤية البلاغات في منطقتك الجغرافية والمساعدة في التحقق منها أو إيصال الرسائل لمن لا يملكون اتصالاً بالإنترنت.
                </p>
                {!userProfile?.isVolunteer && (
                  <button onClick={() => saveProfile(userProfile?.location || '', true)} className="mt-4 bg-white text-[#5A5A40] px-4 py-2 rounded-xl font-bold text-sm">
                    الانضمام كمتطوع
                  </button>
                )}
              </div>
              
              {userProfile?.isVolunteer && (
                <div className="space-y-4">
                  <h4 className="font-bold opacity-70 border-b border-[#E8E2D9] pb-2">طلبات التحقق في منطقتك</h4>
                  <div className="bg-white p-4 organic-card border border-[#E8E2D9] flex justify-between items-center">
                     <div>
                       <p className="font-bold text-sm">عائلة آل صالح</p>
                       <p className="text-xs text-[#7A7169]">تحتاج تأكيد تواجد في مخيم الجفينة</p>
                     </div>
                     <button className="text-[#B3543B] font-bold text-sm">التفاصيل</button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col items-center gap-4 bg-white p-8 organic-card border border-[#E8E2D9]">
                <div className="relative">
                  <img src={user.photoURL || 'https://via.placeholder.com/150'} className="w-24 h-24 rounded-[30px] border-4 border-[#F9F6F1]" alt="Avatar" />
                  <button className="absolute bottom-[-10px] right-[-10px] bg-[#B3543B] text-white p-2 rounded-full shadow-lg">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-center">
                  <h2 className="text-2xl font-bold font-serif text-[#2A2623]">{user.displayName}</h2>
                  <p className="text-[#7A7169] text-sm">{user.email}</p>
                </div>
              </div>
              
              <div className="space-y-4 bg-white p-6 organic-card border border-[#E8E2D9]">
                <div>
                  <label className="text-xs font-bold opacity-70 mb-1 block">الموقع التقريبي الحالي</label>
                  <input 
                    type="text" 
                    placeholder="مثال: محافظة تعز، مديرية الشمايتين" 
                    className="w-full bg-[#F9F6F1] border border-[#E8E2D9] p-3 rounded-xl text-sm"
                    defaultValue={userProfile?.location || ''}
                    onBlur={(e) => saveProfile(e.target.value, userProfile?.isVolunteer || false)}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={() => signOut(auth)}
                  className="w-full bg-[#FDFBF7] p-4 organic-card text-right font-bold text-[#B3543B] border border-[#E8E2D9]"
                >
                  تسجيل الخروج
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#FDFBF7] border-t border-[#E8E2D9] px-6 py-4 z-40 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <NavButton active={activeTab === 'home'} onClick={() => setActiveTab('home')} icon={<Heart />} label="الرئيسية" />
          <NavButton active={activeTab === 'matches'} onClick={() => setActiveTab('matches')} icon={<Bell />} label="تطابق" />
          <NavButton active={activeTab === 'volunteers'} onClick={() => setActiveTab('volunteers')} icon={<Shield />} label="المتطوعين" />
          <NavButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<Users />} label="حسابي" />
        </div>
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactElement, label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all rounded-xl p-2",
        active ? "text-[#B3543B] font-black scale-110" : "text-[#7A7169]"
      )}
    >
      <div className={cn(
        "p-2 rounded-xl transition-all",
        active ? "bg-[#F9F6F1] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] border border-[#E8E2D9]" : ""
      )}>
        {React.cloneElement(icon, { 
          className: cn('w-6 h-6', (icon.props as any).className) 
        } as React.HTMLAttributes<HTMLElement>)}
      </div>
      <span className="text-[10px] uppercase font-bold tracking-wider">{label}</span>
    </button>
  );
}

// Sub-component for Chat
function ChatView({ channelId, onBack, currentUid }: { channelId: string, onBack: () => void, currentUid: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [isVoiceVerified, setIsVoiceVerified] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'messages'), where('channelId', '==', channelId), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
    return unsub;
  }, [channelId]);

  const send = async () => {
    if (!text.trim()) return;
    await addDoc(collection(db, 'messages'), {
      channelId,
      senderId: currentUid,
      text,
      createdAt: serverTimestamp()
    });
    setText('');
  };

  const verifyIdentity = () => {
    // In a real app, this would involve sending a voice snippet to the other party or AI for verification
    setIsVoiceVerified(true);
    addDoc(collection(db, 'messages'), {
      channelId,
      senderId: currentUid,
      text: "✅ لقد قمت بتأكيد هويتي عبر البصمة الصوتية.",
      createdAt: serverTimestamp()
    });
  };

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col h-[70vh] bg-white organic-card border border-[#E8E2D9] overflow-hidden">
      <div className="bg-[#E8E2D9] p-4 flex items-center justify-between border-b border-[#D9D1C7]">
        <div className="flex items-center gap-3">
          <button onClick={onBack}><ChevronLeft className="w-6 h-6 rotate-180 text-[#4A443F]" /></button>
          <div>
            <h3 className="font-bold text-[#2A2623]">تواصل آمن (مجهول)</h3>
            <p className="text-[10px] text-[#7A7169]">تفاصيل الاتصال مخفية حتى يتم تأكيد الهوية</p>
          </div>
        </div>
        <Shield className="w-5 h-5 text-[#B3543B]" />
      </div>

      {!isVoiceVerified && (
        <div className="bg-[#F9F6F1] p-3 border-b border-[#E8E2D9] text-center space-y-2">
          <p className="text-xs text-[#5A5A40]">للكشف عن أرقام هواتفكم، يرجى تأكيد الهوية عبر بصمة صوتية قصيرة.</p>
          <button onClick={verifyIdentity} className="text-xs bg-[#5A5A40] text-white px-4 py-2 rounded-full font-bold">
            تأكيد هويتي صوتياً
          </button>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#FDFBF7]">
        {messages.map(msg => {
          const isMe = msg.senderId === currentUid;
          return (
            <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
              <div className={cn(
                "p-3 max-w-[80%] organic-card text-sm",
                isMe ? "bg-[#B3543B] text-white" : "bg-[#E8E2D9] text-[#2A2623]"
              )}>
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      
      <div className="p-4 bg-white border-t border-[#E8E2D9] flex gap-2">
        <input 
          type="text" 
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="اكتب رسالة..." 
          className="flex-1 bg-[#F9F6F1] border border-[#E8E2D9] rounded-full px-4 text-sm focus:outline-none focus:border-[#B3543B]"
        />
        <button onClick={send} className="w-10 h-10 bg-[#5A5A40] text-white rounded-full flex items-center justify-center">
          <Send className="w-4 h-4 rtl:-scale-x-100" />
        </button>
      </div>
    </motion.div>
  );
}
