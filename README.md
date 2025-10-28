🚀 LeDo Web Manager: AI-Enhanced Community Leader Tool

LeDo (Community Manager for Community Leaders) is a modern, cloud-based web application designed to help campus leads and community organizers efficiently manage tasks, teams, and strategy across multiple communities.

Builder: Abhijith
https://github.com/abhi-jithb

This project evolved from an offline-first mobile concept into a powerful, cloud-persistent tool with integrated AI assistance for strategic planning and analysis.

✨ Key Features

Management & Collaboration

Multi-Community Support: Easily switch between and manage tasks for any number of distinct communities (e.g., TinkerHub, FOSS, Mulearn).

Centralized Task Tracking: Assign tasks to specific members within each community, set deadlines, and track status (Todo, Processing, Done).

Real-Time Alerts: In-app banner notifications for critical deadlines (due today and due tomorrow) and for tasks marked with a low-priority 'Todo' status.

History Log: View completed tasks sorted by date for easy review and reporting.

Community Management: Dedicated settings screen to create new communities, add/remove members, and delete communities.

AI-Enhanced Strategy

AI Strategist Chat: An integrated chat system powered by the Gemini API that serves as a personal consultant.

Context-Aware Suggestions: The AI uses your current community structure and task data to provide highly relevant strategic help.

Creative Assistance: Get suggestions for events and creative names for your initiatives.

Activity Analysis: Receive constructive feedback and analysis on your community's past performance and task load distribution.

Technical Foundation

Cloud Persistence: All data (tasks, communities, and chat history) is stored securely in Google Firestore, ensuring data is backed up and accessible across devices.

User Authentication: Users are authenticated via secure custom tokens or anonymous sign-in, enabling secure, personalized cloud storage.

💻 Technical Stack

Area

Technology

Purpose

Frontend

React (Functional Components, Hooks)

Core UI and State Management

Styling

Tailwind CSS

Utility-first CSS framework for responsive, modern design

Database

Firebase Firestore

Real-time, cloud-based persistence for all application data

Authentication

Firebase Auth

Secure user sign-in and persistence

AI/LLM

Gemini API (gemini-2.5-flash-preview-09-2025)

Strategic chat, analysis, and creative suggestions

Icons

Lucide React

Clean, scalable vector icons

🚀 Getting Started (Setup from Scratch)

1. Prerequisites

Ensure you have Node.js (18+) and a package manager (npm or yarn) installed.

2. Project Setup

If you were setting up this project from scratch using a tool like Vite:

# 1. Clone the repository (replace with your actual repo name if applicable)

git clone ledo-web-manager
cd ledo-web-manager

# 2. Install dependencies

npm install

# or yarn install

# 3. Install Firebase, Lucide Icons, and Tailwind/PostCSS dependencies

npm install firebase lucide-react tailwindcss postcss autoprefixer

3. Firebase Configuration

This application relies on the following global environment variables being supplied by the runtime environment for initialization:

\_\_app_id: The unique application ID for Firestore structure.

\_\_firebase_config: The JSON object containing your Firebase project configuration.

\_\_initial_auth_token: A Firebase Custom Auth Token for initial user sign-in.

The app uses getAuth and getFirestore with these variables to connect to your project's cloud resources.

4. Running the App

Start the development server:

npm run dev

# or yarn dev

The application will launch in your browser, where you can immediately sign in (anonymously or via token) and start creating your first community on the Settings screen.

🗺️ Data Storage Structure (Firestore)

LeDo organizes data into public collections (for shared tasks/communities) and private collections (for user-specific history):

Data Type

Collection Path

Purpose

Communities

/artifacts/{appId}/public/data/communities

Community details, owner ID, and member lists.

Tasks

/artifacts/{appId}/public/data/tasks

Task details, status, deadlines, and community reference.

Chat History

/artifacts/{appId}/users/{userId}/chat_history

Private AI chat history and queries.

This setup allows shared access to tasks and communities, while maintaining private chat history.
