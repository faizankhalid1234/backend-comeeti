import app, { initApp } from '../server.js';

export default async function handler(req, res) {
  try {
    await initApp();
    return app(req, res);
  } catch (error) {
    console.error('❌ Error handling request:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
}

