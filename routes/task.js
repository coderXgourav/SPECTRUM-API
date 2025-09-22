import express, { Router } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';


// this is the task.js

const taskRouter = Router();

// Get storage with subscription validation
taskRouter.get('/get-storage/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getFirestore();

    // 1. Check user subscription
    const userQuery = db.collection('users').where('user_id', '==', userId);
    const userSnapshot = await userQuery.get();
    
    if (userSnapshot.empty) {
      return res.status(404).json({
        error: 'User not found',
        success: false
      });
    }
    
    const userData = userSnapshot.docs[0].data();
    const now = new Date();
    
    // Check if user has active subscription
    if (userData.subscriptionStatus !== 'active') {
      return res.status(403).json({
        error: 'Active subscription required',
        success: false
      });
    }
    
    // Check subscription expiry
    if (userData.expiryDate && new Date(userData.expiryDate) < now) {
      return res.status(403).json({
        error: 'Subscription has expired',
        success: false
      });
    }

    // Return storage information
    return res.status(200).json({
      success: true,
      message: 'Storage access granted',
      storage: userData.storage || '0GB',
      // maxStorage: userData.maxStorage || '1GB',
      // storageUsed: userData.storageUsed || '0GB'
    });

  } catch (error) {
    console.error('❌ Error getting storage:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to get storage',
      details: error.message
    });
  }
});

// Generate group with subscription validation
taskRouter.post('/generate-group/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getFirestore();

    // 1. Check user subscription and limits
    const userQuery = db.collection('users').where('user_id', '==', userId);
    const userSnapshot = await userQuery.get();
    
    if (userSnapshot.empty) {
      return res.status(404).json({
        error: 'User not found',
        success: false
      });
    }
    
    const userData = userSnapshot.docs[0].data();
    const now = new Date();
    
    // Check if user has active subscription
    if (userData.subscriptionStatus !== 'active') {
      return res.status(403).json({
        error: 'Active subscription required',
        success: false
      });
    }
    
    // Check subscription expiry
    if (userData.expiryDate && new Date(userData.expiryDate) < now) {
      return res.status(403).json({
        error: 'Subscription has expired',
        success: false
      });
    }
    
    // Check maxGroup limit
    const maxGroup = userData.maxGroup || 0;
    if (maxGroup <= 0) {
      return res.status(403).json({
        error: 'Group creation not allowed. You’ve already reached the limit.',
        success: false
      });
    }

    // 2. Decrement maxGroup count
    const userDocRef = userSnapshot.docs[0].ref;
    await userDocRef.update({
      maxGroup: maxGroup - 1,
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: 'Validation passed - ready to create group',
      canCreateGroup: true,
      remainingGroups: maxGroup - 1
    });

  } catch (error) {
    console.error('❌ Error generating group:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to generate group',
      details: error.message
    });
  }
});

// Generate post with subscription validation
taskRouter.post('/generate-post/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { title, description, category, tags } = req.body;
    const db = getFirestore();

    // 1. Check user subscription and limits
    const userQuery = db.collection('users').where('user_id', '==', userId);
    const userSnapshot = await userQuery.get();
    
    if (userSnapshot.empty) {
      return res.status(404).json({
        error: 'User not found',
        success: false
      });
    }
    
    const userData = userSnapshot.docs[0].data();
    const now = new Date();
    
    // Check if user has active subscription
    if (userData.subscriptionStatus !== 'active') {
      return res.status(403).json({
        error: 'Active subscription required',
        success: false
      });
    }
    
    // Check subscription expiry
    if (userData.expiryDate && new Date(userData.expiryDate) < now) {
      return res.status(403).json({
        error: 'Subscription has expired',
        success: false
      });
    }
    
    // Check if user is in trial period
    const isTrialPeriod = userData.subscriptionDate && 
      userData.packageId && 
      (!userData.expiryDate || new Date(userData.subscriptionDate) > new Date(userData.expiryDate));
    
    if (isTrialPeriod) {
      // Check trial posts limit
      const trialPostsUsed = userData.trialPostsUsed || 0;
      const packageQuery = db.collection('packages').where('packageId', '==', userData.packageId);
      const packageSnapshot = await packageQuery.get();
      
      if (!packageSnapshot.empty) {
        const packageData = packageSnapshot.docs[0].data();
        const trialPosts = parseInt(packageData.trialPosts) || 0;
        
        if (trialPostsUsed >= trialPosts) {
          return res.status(403).json({
            error: 'Trial posts limit exceeded',
            success: false
          });
        }
      }
    } else {
      // Check remaining posts for paid subscription
      if (!userData.remainingPosts || userData.remainingPosts <= 0) {
        return res.status(403).json({
          error: 'No remaining posts available',
          success: false
        });
      }
    }

    // 2. Update user limits (decrement remainingPosts)
    const userDocRef = userSnapshot.docs[0].ref;
    if (!isTrialPeriod) {
      // Decrement remaining posts for paid subscription
      await userDocRef.update({
        remainingPosts: userData.remainingPosts - 1,
        updatedAt: new Date().toISOString()
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Validation passed - ready to create post',
      canCreatePost: true,
      remainingPosts: isTrialPeriod ? 'unlimited' : userData.remainingPosts - 1
    });

  } catch (error) {
    console.error('❌ Error generating post:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to generate post',
      details: error.message
    });
  }
});

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

    // 2. Check user subscription and limits
    const userQuery = db.collection('users').where('user_id', '==', userId);
    const userSnapshot = await userQuery.get();
    
    if (userSnapshot.empty) {
      return res.status(404).json({
        error: 'User not found',
        success: false
      });
    }
    
    const userData = userSnapshot.docs[0].data();
    const now = new Date();
    
    console.log('User data:', JSON.stringify(userData, null, 2));
    console.log('Current time:', now.toISOString());
    
    // Check if user has active subscription
    if (userData.subscriptionStatus !== 'active') {
      console.log('Subscription status check failed:', userData.subscriptionStatus);
      return res.status(403).json({
        error: 'Active subscription required',
        success: false
      });
    }
    
    console.log('Subscription status: active ✓');
    
    // Check subscription expiry
    if (userData.expiryDate && new Date(userData.expiryDate) < now) {
      console.log('Subscription expired:', userData.expiryDate);
      return res.status(403).json({
        error: 'Subscription has expired',
        success: false
      });
    }
    
    console.log('Expiry check passed ✓');
    
    // Check if user is in trial period
    const isTrialPeriod = userData.subscriptionDate && 
      userData.packageId && 
      (!userData.expiryDate || new Date(userData.subscriptionDate) > new Date(userData.expiryDate));
    
    console.log('Is trial period:', isTrialPeriod);
    console.log('Subscription date:', userData.subscriptionDate);
    console.log('Package ID:', userData.packageId);
    console.log('Expiry date:', userData.expiryDate);
    
    if (isTrialPeriod) {
      console.log('User is in trial period');
      // Check trial posts limit
      const trialPostsUsed = userData.trialPostsUsed || 0;
      console.log('Trial posts used:', trialPostsUsed);
      
      const packageQuery = db.collection('packages').where('packageId', '==', userData.packageId);
      const packageSnapshot = await packageQuery.get();
      
      if (!packageSnapshot.empty) {
        const packageData = packageSnapshot.docs[0].data();
        const trialPosts = parseInt(packageData.trialPosts) || 0;
        console.log('Trial posts allowed:', trialPosts);
        
        if (trialPostsUsed >= trialPosts) {
          console.log('Trial posts limit exceeded');
          return res.status(403).json({
            error: 'Trial posts limit exceeded',
            success: false
          });
        }
        console.log('Trial posts check passed ✓');
      } else {
        console.log('Package not found for trial user');
      }
    } else {
      console.log('User has paid subscription');
      // Check remaining prompts for paid subscription
      console.log('Remaining prompts:', userData.remainingPrompts);
      if (!userData.remainingPrompts || userData.remainingPrompts <= 0) {
        console.log('No remaining prompts');
        return res.status(403).json({
          error: 'No remaining prompts available',
          success: false
        });
      }
      console.log('Remaining prompts check passed ✓');
    }
    
    console.log('All validation checks passed, proceeding with task generation...');

    // -----------------------------
    // 2. Generate Markdown Roadmap
    // -----------------------------
const markdownPrompt = `
You are a professional business strategist.  
Using the following business idea, create a **structured Markdown roadmap**.

⚡ Rules:
- Start with "# ${postData.title || 'Business Idea'}"
- Then add a 2–3 line descriptive paragraph
- Insert a horizontal rule (---)
- Add "## 🔹 Short Description" and provide bullet points with "*" (not ####)
- Insert another horizontal rule (---)
- Then add "## 🚀 Project Roadmap"
- For each step:
  - Use "### *Step X: Title*" (with italics around the title)
  - Under it, write bullet points starting with "*"
  - Use emojis like ✅ 📊 💡 🚀 naturally where they fit
- Separate each step with "---"
- Keep it **professional, clean, and actionable**
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
          model: 'x-ai/grok-4-fast:free',
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
          model: 'x-ai/grok-4-fast:free',
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
      
      // 6. Update user limits
      const userDocRef = userSnapshot.docs[0].ref;
      if (isTrialPeriod) {
        // Increment trial posts used
        await userDocRef.update({
          trialPostsUsed: (userData.trialPostsUsed || 0) + 1,
          updatedAt: new Date().toISOString()
        });
      } else {
        // Decrement remaining prompts
        await userDocRef.update({
          remainingPrompts: userData.remainingPrompts - 1,
          updatedAt: new Date().toISOString()
        });
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