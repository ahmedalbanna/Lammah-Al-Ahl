/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const transcribeAudio = async (base64Audio: string) => {
  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: base64Audio
          }
        },
        { text: "قم بتلخيص هذا المقطع الصوتي واستخراج الأسماء والمواقع المذكورة باللهجة اليمنية. أعد النتيجة بتنسيق JSON يحتوي على 'name', 'location', 'members', 'description'." }
      ]
    },
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = result.text;
  
  if (!text) return { raw: "لم يتم العثور على نص" };

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON from Gemini", e);
    return { raw: text };
  }
};

export const findMatches = async (reportData: any, registrations: any[]) => {
  const prompt = `
    أنت خبير في الأنساب واللهجات اليمنية. 
    لدينا بلاغ عن مفقود: ${JSON.stringify(reportData)}
    ولدينا قائمة بالعائلات المسجلة: ${JSON.stringify(registrations)}
    
    حدد أفضل 3 مطابقات محتملة بناءً على الاسم، القرية، الوصف، واللقب.
    أعد النتيجة كمصفوفة JSON من الكائنات، كل كائن يحتوي على 'registrationId', 'confidence' (0-1), 'reason'.
  `;

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  });

  const text = result.text;

  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse matches from Gemini", e);
    return [];
  }
};
