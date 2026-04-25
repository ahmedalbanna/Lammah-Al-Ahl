import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, Trash2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob, base64: string) => void;
  isProcessing?: boolean;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete, isProcessing }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64String = (reader.result as string).split(',')[1];
          onRecordingComplete(blob, base64String);
          setAudioUrl(URL.createObjectURL(blob));
        };
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone", err);
      alert("يرجى السماح بالوصول إلى الميكروفون للتسجيل الصوتي.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const reset = () => {
    setAudioUrl(null);
    setIsRecording(false);
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
      <AnimatePresence mode="wait">
        {!audioUrl && !isRecording && (
          <motion.button
            key="start"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            onClick={startRecording}
            className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-200 hover:bg-red-600 transition-colors"
          >
            <Mic className="w-10 h-10 text-white" />
          </motion.button>
        )}

        {isRecording && (
          <motion.button
            key="stop"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            onClick={stopRecording}
            className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center shadow-lg hover:bg-slate-900 transition-colors relative"
          >
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="absolute inset-0 bg-red-500/20 rounded-full"
            />
            <Square className="w-8 h-8 text-white fill-white" />
          </motion.button>
        )}

        {audioUrl && (
          <motion.div
            key="preview"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <div className="flex items-center gap-3 w-full bg-white p-3 rounded-xl shadow-sm">
              <audio src={audioUrl} controls className="w-full h-10" />
              <button
                onClick={reset}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            {isProcessing && (
              <div className="flex items-center gap-2 text-blue-600 font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري تحليل الصوت...
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {!audioUrl && !isRecording && (
        <p className="text-slate-500 font-medium text-center">اضغط للتحدث، احكِ عن عائلتك أو المفقود</p>
      )}
      {isRecording && (
        <p className="text-red-500 font-bold animate-pulse">جاري التسجيل... اضغط للتوقف</p>
      )}
    </div>
  );
};
