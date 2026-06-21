import { pool } from './db.js';
import { createApp } from './app.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const app = createApp(pool);

app.listen(PORT, () => {
  console.log(`Macroracle API listening on http://localhost:${PORT}`);
});
