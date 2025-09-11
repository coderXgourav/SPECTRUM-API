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

    // -----------------------------
    // 2. Generate Markdown Roadmap
    // -----------------------------
    const markdownPrompt = `
You are a professional business strategist. 
Using the following business idea, create a structured step-by-step roadmap in Markdown format. 

Rules:
- Begin with the IDEA TITLE
- Add a SHORT DESCRIPTION (max 2–3 lines, concise but clear)
- Then provide "Step 1", "Step 2", ..., each with clear explanations
- Use Markdown formatting (#, ##, lists, etc.)
- Make it clean, readable, and actionable
- Do not include any extra commentary

Idea Data: ${JSON.stringify(postData, null, 2)}
`;

    const markdownResponse = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-8b-instruct:free',
        messages: [{ role: 'user', content: markdownPrompt }],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let markdownText = markdownResponse.data.choices[0].message.content;
    markdownText = markdownText.replace(/^```(markdown)?\n?|```$/g, '').trim();

    // Save markdown into Firestore under the post
    await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .update({
        markdown: markdownText,
        markdown_created_at: Timestamp.now(),
      });

    // -----------------------------
    // 3. Generate Tasks
    // -----------------------------
    const taskPrompt = `
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

    const tasksResponse = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-8b-instruct:free',
        messages: [{ role: 'user', content: taskPrompt }],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let tasksText = tasksResponse.data.choices[0].message.content;
    tasksText = tasksText.replace(/^```json\n?|```$/g, '').trim();

    let tasks;
    try {
      tasks = JSON.parse(tasksText);
    } catch (e) {
      console.error("AI didn't return valid JSON:", tasksText);
      return res.status(200).json({ raw: tasksText, markdown: markdownText });
    }

    // 4. Fix dates → Firestore Timestamp based on take_time
    const today = new Date();
    let currentDate = new Date(today);

    tasks = tasks.map((task) => {
      const daysNeeded = Math.ceil(task.take_time / 8);
      currentDate.setDate(currentDate.getDate() + daysNeeded);
      return {
        ...task,
        date: Timestamp.fromDate(new Date(currentDate)),
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
      const taskRef = tasksCollection.doc();
      batch.set(taskRef, {
        ...task,
        post_id: postId,
        user_id: userId,
        created_at: Timestamp.now(),
      });
    });
    await batch.commit();

    // ✅ 6. Mark post as "taskGenerated = true"
    await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .update({
        taskGenerated: true,
        taskGenerated_at: Timestamp.now(),
      });

    // 7. Send response
    return res.status(200).json({
      postId: postDoc.id,
      idea: postData.title,
      savedTasks: tasks.length,
      markdown: markdownText,
      taskGenerated: true,
      tasks: tasks.map((task) => ({
        ...task,
        date: task.date.toDate().toLocaleString('en-US', {
          timeZone: 'Asia/Kolkata',
        }),
      })),
    });
  } catch (error) {
    console.error('❌ Error generating tasks & markdown:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to generate tasks & markdown' });
  }
});

export default taskRouter;
