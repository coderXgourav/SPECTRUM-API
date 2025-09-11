import express, { Router } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';

const taskRouter = Router();

taskRouter.get('/generate-tasks/:userId/:postId', async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const db = getFirestore();

    // 1. Fetch post details
    const postDoc = await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .get();

    if (!postDoc.exists) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const postData = postDoc.data();
    // console.log("🔥 Full Post Data:", JSON.stringify(postData, null, 2));

    // 2. Build Prompt with ALL post data
    const prompt = `
You are a professional project planner. Research this business idea in detail and break it down into a complete roadmap of tasks from start (0%) to completion (100%). 
Do not stop at 5–7 tasks. Cover EVERYTHING realistically required.

Each task must follow this format:
{
  "status": "pending",
  "date": "TIMESTAMP",   // placeholder, will be replaced in backend
  "title": "short task name",
  "progress": 0,
  "take_time": number_of_hours,
  "coin": take_time * 10
}

Rules:
- Always return ONLY a JSON array of tasks (no explanation).
- Status = "pending"
- Progress = 0
- take_time = estimated hours needed.
- coin = take_time * 10.
- Do not wrap the JSON in code fences or any other text.

Idea Data: ${JSON.stringify(postData, null, 2)}
    `;

    // 3. Call OpenRouter API
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-8b-instruct:free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let tasksText = response.data.choices[0].message.content;

    // Remove any code fences or extra text
    tasksText = tasksText.replace(/^```json\n|```$/g, '').trim();

    let tasks;
    try {
      tasks = JSON.parse(tasksText);
    } catch (e) {
      console.error("AI didn't return valid JSON:", tasksText);
      return res.status(200).json({ raw: tasksText });
    }

    // 4. Fix dates → Firestore Timestamp based on take_time
    const today = new Date('2025-09-11T15:14:00+05:30'); // Current date and time in IST
    let currentDate = new Date(today);

    tasks = tasks.map((task) => {
      const daysNeeded = Math.ceil(task.take_time / 8); // 8 hours = 1 workday
      currentDate.setDate(currentDate.getDate() + daysNeeded);
      return {
        ...task,
        date: Timestamp.fromDate(new Date(currentDate)), // Firestore Timestamp
      };
    });

    // 5. Save tasks under Firestore
    const tasksCollection = db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .collection('tasks');

    const batch = db.batch();

    tasks.forEach((task) => {
      const taskRef = tasksCollection.doc(); // auto-generated ID
      batch.set(taskRef, {
        ...task,
        post_id: postId,
        user_id: userId,
        created_at: Timestamp.now(),
      });
    });

    await batch.commit();

    // 6. Send response
    return res.status(200).json({
      postId: postDoc.id,
      idea: postData.title,
      savedTasks: tasks.length,
      tasks: tasks.map(task => ({
        ...task,
        date: task.date.toDate().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) // Convert Timestamp to readable string for response
      })),
    });
  } catch (error) {
    console.error('❌ Error generating tasks:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to generate tasks' });
  }
});

export default taskRouter;