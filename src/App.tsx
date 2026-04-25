/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Search, 
  Heart, 
  Phone, 
  MapPin, 
  Mic, 
  Plus, 
  ChevronLeft, 
  LogOut, 
  Bell,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { auth, db, loginWithGoogle } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { AudioRecorder } from './components/AudioRecorder';
import { transcribeAudio, findMatches } from './lib/gemini';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tab = 'home' | 'register' | 'search' | 'matches' | 'profile';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [myMatches, setMyMatches] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

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

    // Listen to matches (In a real app, I'd query matches specifically for this user's reports/registrations)
    const qMatches = query(collection(db, 'matches'));
    const unsubMatches = onSnapshot(qMatches, (snapshot) => {
      setMyMatches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubReg();
      unsubRep();
      unsubMatches();
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

      // Simple matching logic: fetch all registrations and find best matches via Gemini
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-natural-bg">
        <Loader2 className="w-10 h-10 text-clay animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-natural-bg p-6 text-right" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full space-y-8 text-center"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-clay rounded-full flex items-center justify-center shadow-2xl shadow-clay/30 transform -rotate-12">
              <Heart className="w-10 h-10 text-white" />
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-5xl font-serif font-bold text-natural-text tracking-tight">لمّة الأهل</h1>
            <p className="text-natural-text/70 text-lg leading-relaxed font-sans font-medium">
              لأن الفقد أقسى من الجوع... منصة تجمع شتات العائلات اليمنية النازحة بكرامة.
            </p>
          </div>
          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-natural-card border border-stone p-5 organic-card font-bold text-natural-text hover:bg-stone/20 transition-all shadow-sm"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
            الدخول عبر جوجل للبدء
          </button>
          <div className="flex items-center justify-center gap-2 text-xs font-bold text-clay/60 uppercase tracking-widest">
            <span className="w-8 h-[1px] bg-stone"></span>
            نظام #149# مفعل
            <span className="w-8 h-[1px] bg-stone"></span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-right pb-24" dir="rtl">
      {/* Header */}
      <header className="bg-white sticky top-0 z-30 border-b border-slate-100 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
            <Heart className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">لمّة الأهل</h1>
        </div>
        <div className="flex items-center gap-4">
          <button className="relative p-2 text-slate-400 hover:bg-slate-50 rounded-full transition-colors">
            <Bell className="w-6 h-6" />
            {myMatches.length > 0 && (
              <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
            )}
          </button>
          <button 
            onClick={() => signOut(auth)}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
          >
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-6 space-y-8">
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
              <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-3xl text-white shadow-2xl shadow-blue-200 relative overflow-hidden">
                <div className="relative z-10 space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold">أهلاً بك يا {user.displayName?.split(' ')[0]}</h2>
                    <p className="opacity-90 text-sm mt-1">نحن هنا لنساعدك في الوصول لأحبابك.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setActiveTab('register')}
                      className="bg-white/20 backdrop-blur-md p-4 rounded-2xl flex flex-col items-center gap-2 hover:bg-white/30 transition-colors border border-white/30"
                    >
                      <Plus className="w-8 h-8" />
                      <span className="font-bold text-sm">تسجيل عائلتي</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('search')}
                      className="bg-white/20 backdrop-blur-md p-4 rounded-2xl flex flex-col items-center gap-2 hover:bg-white/30 transition-colors border border-white/30"
                    >
                      <Search className="w-8 h-8" />
                      <span className="font-bold text-sm">أبحث عن مفقود</span>
                    </button>
                  </div>
                </div>
                {/* Decorative BG pattern */}
                <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-400/20 rounded-full -ml-16 -mb-16 blur-2xl" />
              </div>

              {/* My Registrations */}
              <section className="space-y-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  عائلاتي المسجلة
                </h3>
                {registrations.length === 0 ? (
                  <div className="bg-white p-8 rounded-2xl border-2 border-dashed border-slate-200 text-center space-y-2">
                    <Users className="w-10 h-10 text-slate-300 mx-auto" />
                    <p className="text-slate-500 font-medium tracking-tight">لم تسجل أي عائلة بعد.</p>
                    <button 
                      onClick={() => setActiveTab('register')}
                      className="text-blue-600 font-bold hover:underline"
                    >
                      سجل الآن
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {registrations.map((reg) => (
                      <div key={reg.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-900">{reg.headName}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" /> {reg.currentLocation}
                          </p>
                        </div>
                        <CheckCircle2 className="w-6 h-6 text-green-500" />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* My Reports */}
              <section className="space-y-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Search className="w-5 h-5 text-indigo-600" />
                  طلبات البحث الخاصة بي
                </h3>
                {reports.length === 0 ? (
                    <p className="text-slate-400 text-sm italic">لا يوجد بلاغات بحث نشطة.</p>
                ) : (
                  <div className="space-y-3">
                    {reports.map((rep) => (
                      <div key={rep.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex justify-between items-start">
                          <p className="font-bold text-slate-900 line-clamp-1">{rep.missingPersonDetails}</p>
                          <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full font-bold uppercase">قيد البحث</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">
                          {rep.createdAt?.toDate().toLocaleDateString('ar-YE')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
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
              <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 transition-colors">
                <ChevronLeft className="w-5 h-5 rotate-180" />
                <span>العودة للرئيسية</span>
              </button>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-900">تسجيل العائلة (البطاقة الصوتية)</h2>
                <p className="text-slate-500">سجل بصوتك بيانات عائلتك المتواجدة معك الآن. اذكر اللقب، القرية، وأسماء الأفراد.</p>
              </div>
              <AudioRecorder onRecordingComplete={handleRegisterFamily} isProcessing={isProcessing} />
              
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 space-y-2">
                <p className="text-blue-800 font-bold text-sm">لماذا نسجل بصوتنا؟</p>
                <p className="text-blue-700 text-xs leading-relaxed">
                  الصوت لا يخطئ. لهجتك ونبرة صوتك قد تكون هي المفتاح لتعرف أقاربك المفقودين عليك. نحن نستخدم ذكاءً اصطناعياً يمنياً يفهمك.
                </p>
              </div>
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
              <button onClick={() => setActiveTab('home')} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 transition-colors">
                <ChevronLeft className="w-5 h-5 rotate-180" />
                <span>العودة</span>
              </button>
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-900">أبحث عن مفقود</h2>
                <p className="text-slate-500">احكِ لنا من تبحث عنه؟ اسمه، عمره، آخر مكان رأيته فيه، وأي علامات مميزة.</p>
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
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-900">تطابقات محتملة ✨</h2>
                <p className="text-slate-500">وجدنا بعض العائلات التي قد تكون لعائلتك المفقودة. استمع وتأكد.</p>
              </div>

              {myMatches.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-slate-500 font-medium">لا يوجد تطابقات مؤكدة حتى الآن.<br/>سيصلك تنبيه فور العثور على شيء.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {myMatches.map((match) => (
                    <motion.div 
                      key={match.id}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="bg-white p-6 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-black uppercase">
                          تطابق بنسبة {Math.round(match.confidence * 100)}%
                        </div>
                        <Heart className="w-5 h-5 text-red-500" />
                      </div>
                      
                      <div className="space-y-2">
                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">تحليل الذكاء الاصطناعي</p>
                        <p className="text-slate-800 text-sm leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100 italic">
                          "{match.reason}"
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <button className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-2xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-5 h-5" />
                          نعم، هذا هو!
                        </button>
                        <button className="p-3 text-slate-400 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-colors">
                          <Phone className="w-6 h-6" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
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
              <div className="flex flex-col items-center gap-4 bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
                <img src={user.photoURL || ''} className="w-24 h-24 rounded-3xl shadow-lg border-4 border-white" alt="Avatar" />
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-slate-900">{user.displayName}</h2>
                  <p className="text-slate-500 text-sm">{user.email}</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <button className="w-full bg-white p-4 rounded-2xl text-right font-bold text-slate-700 border border-slate-100 flex items-center justify-between group hover:border-blue-300 transition-colors">
                  إعدادات الخصوصية والأمان
                  <ChevronLeft className="w-5 h-5 text-slate-300 group-hover:text-blue-500" />
                </button>
                <button className="w-full bg-white p-4 rounded-2xl text-right font-bold text-slate-700 border border-slate-100 flex items-center justify-between group hover:border-blue-300 transition-colors">
                  المتطوعين القريبين مني
                  <ChevronLeft className="w-5 h-5 text-slate-300 group-hover:text-blue-500" />
                </button>
                <button 
                  onClick={() => signOut(auth)}
                  className="w-full bg-red-50 p-4 rounded-2xl text-right font-bold text-red-600 border border-red-100"
                >
                  تسجيل الخروج
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-slate-100 px-6 py-4 z-40">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <NavButton active={activeTab === 'home'} onClick={() => setActiveTab('home')} icon={<Heart />} label="لمّة" />
          <NavButton active={activeTab === 'matches'} onClick={() => setActiveTab('matches')} icon={<Bell />} label="تطابق" />
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
        "flex flex-col items-center gap-2 transition-all p-2",
        active ? "text-clay font-black scale-110" : "text-stone-600"
      )}
    >
      <div className={cn(
        "p-2.5 rounded-full transition-all",
        active ? "bg-clay/10 shadow-inner" : ""
      )}>
        {React.cloneElement(icon, { 
          className: cn('w-6 h-6', (icon.props as any).className) 
        } as React.HTMLAttributes<HTMLElement>)}
      </div>
      <span className="text-[10px] uppercase font-bold tracking-widest">{label}</span>
    </button>
  );
}

function ProfileButton({ label }: { label: string }) {
  return (
    <button className="w-full bg-natural-card p-5 organic-card text-right font-bold text-natural-text border border-stone flex items-center justify-between group hover:border-clay/40 transition-all shadow-sm">
      <span className="font-serif text-lg">{label}</span>
      <ChevronLeft className="w-5 h-5 text-stone group-hover:text-clay group-hover:-translate-x-1 transition-all" />
    </button>
  );
}
