import express, { Router } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';

const taskRouter = Router();

// Generate tasks and markdown (your existing endpoint - improved)
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
      return res.status(404).json({ 
        error: 'Post not found',
        success: false 
      });
    }

    const postData = postDoc.data();

    // Check if tasks are already generated
    if (postData.taskGenerated) {
      return res.status(200).json({
        success: true,
        postId: postDoc.id,
        idea: postData.title,
        markdown: postData.markdown,
        taskGenerated: true,
        message: 'Tasks already generated',
        alreadyExists: true
      });
    }

    // -----------------------------
    // 2. Generate Markdown Roadmap
    // -----------------------------
    const markdownPrompt = `
You are a professional business strategist.  
Using the following business idea, create a **structured Markdown roadmap**.

⚡ Rules:
- Start with "## ${postData.title || 'BUSINESS IDEA'}"
- Then add a short **2–3 line description**
- Insert a horizontal rule (---)
- Add "### 🔹 Short Description" with bullet points as "####"
- Insert another horizontal rule (---)
- Then add "### 🚀 Project Roadmap"
- Break the roadmap into "### Step 1: Title" and under it list points as "####"
- Separate each step with "---"
- Keep it **professional, clean, and actionable**
- Use emojis (🔹, 🚀, ✅, 📊, 💡) for clarity but don't overuse them
- Do NOT include any explanation outside of Markdown
- Output only Markdown text (no JSON, no extra commentary)

Here is the idea data you must format:
${JSON.stringify(postData, null, 2)}
`;

    let markdownText = '';
    try {
      const markdownResponse = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'openrouter/sonoma-dusk-alpha',
          messages: [{ role: 'user', content: markdownPrompt }],
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 seconds timeout
        }
      );

      markdownText = markdownResponse.data.choices[0].message.content;
      markdownText = markdownText.replace(/^```(markdown)?\n?|```$/g, '').trim();

      // Ensure \n are properly formatted
      markdownText = markdownText.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n\n');
    } catch (markdownError) {
      console.error('❌ Error generating markdown:', markdownError.message);
      markdownText = `## ${postData.title || 'Business Idea'}\n\nRoadmap generation failed. Please try again.`;
    }

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
  "sub_title": "short sub description",
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

    let tasks = [];
    try {
      const tasksResponse = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'openrouter/sonoma-dusk-alpha',
          messages: [{ role: 'user', content: taskPrompt }],
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 seconds timeout
        }
      );

      let tasksText = tasksResponse.data.choices[0].message.content;
      tasksText = tasksText.replace(/^```json\n?|```$/g, '').trim();

      try {
        tasks = JSON.parse(tasksText);
        if (!Array.isArray(tasks)) {
          throw new Error('Tasks response is not an array');
        }
      } catch (parseError) {
        console.error("AI didn't return valid JSON:", tasksText);
        return res.status(200).json({ 
          success: false,
          raw: tasksText, 
          markdown: markdownText,
          error: 'Task generation failed - invalid JSON format',
          postId: postDoc.id,
          idea: postData.title
        });
      }
    } catch (taskError) {
      console.error('❌ Error generating tasks:', taskError.message);
      return res.status(200).json({
        success: false,
        markdown: markdownText,
        error: 'Task generation failed',
        postId: postDoc.id,
        idea: postData.title
      });
    }

    // 4. Fix dates → Firestore Timestamp based on take_time
    const today = new Date();
    let currentDate = new Date(today);

    tasks = tasks.map((task, index) => {
      const daysNeeded = Math.ceil((task.take_time || 8) / 8); 
      currentDate.setDate(currentDate.getDate() + daysNeeded);
      return {
        ...task,
        id: `task_${index + 1}`,
        date: Timestamp.fromDate(new Date(currentDate)),
        status: task.status || 'pending',
        progress: task.progress || 0,
        take_time: task.take_time || 8,
        coin: (task.take_time || 8) * 10
      };
    });

    // 5. Save tasks and markdown to Firestore
    try {
      await db
        .collection('users')
        .doc(userId)
        .collection('posts')
        .doc(postId)
        .update({
          markdown: markdownText,
          markdown_created_at: Timestamp.now(),
          taskGenerated: true,
          taskGenerated_at: Timestamp.now(),
          total_tasks: tasks.length
        });

      if (tasks.length > 0) {
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
      }
    } catch (firestoreError) {
      console.error('❌ Error saving to Firestore:', firestoreError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to save data to database',
        markdown: markdownText,
        tasks: tasks
      });
    }

    // 7. Send successful response
    return res.status(200).json({
      success: true,
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
    return res.status(500).json({ 
      success: false,
      error: 'Failed to generate tasks & markdown',
      details: error.message
    });
  }
});

// NEW: Get existing markdown and tasks (for preview)
taskRouter.get('/roadmap/:userId/:postId', async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const db = getFirestore();

    const postDoc = await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .get();

    if (!postDoc.exists) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }

    const postData = postDoc.data();

    if (!postData.markdown || !postData.taskGenerated) {
      return res.status(200).json({
        success: false,
        postId: postDoc.id,
        idea: postData.title,
        taskGenerated: false,
        message: 'Roadmap not generated yet',
        suggestGenerate: true
      });
    }

    const tasksSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .collection('tasks')
      .orderBy('created_at')
      .get();

    const tasks = tasksSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      date: doc.data().date?.toDate().toLocaleString('en-US', {
        timeZone: 'Asia/Kolkata',
      }) || 'No date set'
    }));

    return res.status(200).json({
      success: true,
      postId: postDoc.id,
      idea: postData.title,
      markdown: postData.markdown,
      taskGenerated: postData.taskGenerated,
      markdown_created_at: postData.markdown_created_at,
      total_tasks: tasks.length,
      tasks: tasks
    });

  } catch (error) {
    console.error('❌ Error fetching roadmap:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to fetch roadmap',
      details: error.message
    });
  }
});

// NEW: Get only markdown content (lightweight)
taskRouter.get('/markdown/:userId/:postId', async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const db = getFirestore();

    const postDoc = await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .get();

    if (!postDoc.exists) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }

    const postData = postDoc.data();

    return res.status(200).json({
      success: true,
      postId: postDoc.id,
      idea: postData.title,
      markdown: postData.markdown || '',
      taskGenerated: postData.taskGenerated || false,
      markdown_created_at: postData.markdown_created_at
    });

  } catch (error) {
    console.error('❌ Error fetching markdown:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to fetch markdown' 
    });
  }
});

// NEW: Regenerate only markdown (without tasks)
taskRouter.post('/regenerate-markdown/:userId/:postId', async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const db = getFirestore();

    const postDoc = await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .get();

    if (!postDoc.exists) {
      return res.status(404).json({ 
        success: false,
        error: 'Post not found' 
      });
    }

    const postData = postDoc.data();

    const markdownPrompt = `
You are a professional business strategist.  
Using the following business idea, create a **structured Markdown roadmap**.

⚡ Rules:
- Start with "## ${postData.title || 'BUSINESS IDEA'}"
- Then add a short **2–3 line description**
- Insert a horizontal rule (---)
- Add "### 🔹 Short Description" with bullet points as "####"
- Insert another horizontal rule (---)
- Then add "### 🚀 Project Roadmap"
- Break the roadmap into "### Step 1: Title" and under it list points as "####"
- Separate each step with "---"
- Keep it **professional, clean, and actionable**
- Use emojis (🔹, 🚀, ✅, 📊, 💡) for clarity but don't overuse them
- Do NOT include any explanation outside of Markdown
- Output only Markdown text (no JSON, no extra commentary)

Here is the idea data you must format:
${JSON.stringify(postData, null, 2)}
`;

    const markdownResponse = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.3-8b-instruct:free',
        messages: [{ role: 'user', content: markdownPrompt }],
        temperature: 0.8, // Slightly higher for variety
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    let markdownText = markdownResponse.data.choices[0].message.content;
    markdownText = markdownText.replace(/^```(markdown)?\n?|```$/g, '').trim();
    markdownText = markdownText.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n\n');

    await db
      .collection('users')
      .doc(userId)
      .collection('posts')
      .doc(postId)
      .update({
        markdown: markdownText,
        markdown_updated_at: Timestamp.now(),
      });

    return res.status(200).json({
      success: true,
      postId: postDoc.id,
      idea: postData.title,
      markdown: markdownText,
      message: 'Markdown regenerated successfully'
    });

  } catch (error) {
    console.error('❌ Error regenerating markdown:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to regenerate markdown' 
    });
  }
});

export default taskRouter;