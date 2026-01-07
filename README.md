# Polyglot Backend API

Backend API server for Polyglot Mobile app. Built with Node.js, Express, TypeScript, and Drizzle ORM.

## Features

- ✅ Voice translation via Gemini Interactions API
- ✅ Vision translation (OCR + translation)
- ✅ Document translation and summarization
- ✅ PostgreSQL database with Drizzle ORM
- ✅ Automatic migrations on Railway deployment
- ✅ Rate limiting
- ✅ Error handling
- ✅ Request validation
- ✅ Logging

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL (via Drizzle ORM)
- **AI SDK**: `@google/genai` (Gemini Interactions API)
- **Validation**: Zod
- **Logging**: Winston
- **ORM**: Drizzle

## Prerequisites

- Node.js 20+ installed
- Google Gemini API key
- PostgreSQL database (Railway provides this)

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=3000
NODE_ENV=development
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_URL=postgresql://user:pass@localhost:5432/polyglot
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
```

### 3. Set Up Database

```bash
# Generate migrations from schema
npm run db:generate

# Run migrations locally
npm run db:migrate
```

### 4. Run Development Server

```bash
npm run dev
```

Server will start on `http://localhost:3000`

### 5. Build for Production

```bash
npm run build
```

### 6. Run Production Build

```bash
npm start
```

## Database Schema

### Tables
- **users** - User accounts
- **interactions** - Gemini interaction IDs and metadata
- **voice_sessions** - Voice translation sessions
- **vision_translations** - Vision translation results
- **document_translations** - Document translation results
- **follow_up_questions** - Follow-up questions from Gemini

See `src/db/schema.ts` for complete schema definitions.

## Database Migrations

### Generate Migrations
```bash
npm run db:generate
```

This reads `src/db/schema.ts` and generates SQL migrations in `drizzle/` folder.

### Run Migrations Locally
```bash
npm run db:migrate
```

### Railway Automatic Migrations
Migrations run automatically on Railway deployment via `postinstall` script:
```json
"postinstall": "npm run db:migrate"
```

**Important**: Ensure `DATABASE_URL` is set in Railway environment variables.

## API Endpoints

### Health Check

```
GET /health
```

### Voice Translation

```
POST /api/v1/voice/translate
Content-Type: application/json

{
  "audio": "base64_encoded_audio",
  "sourceLanguage": "en",
  "targetLanguage": "hi",
  "previousInteractionId": "optional_interaction_id"
}
```

### Vision Translation

```
POST /api/v1/vision/translate
Content-Type: multipart/form-data

- image: File (max 10MB)
- targetLanguage: "en"
```

### Document Translation

```
POST /api/v1/documents/translate
Content-Type: multipart/form-data

- document: File (max 20MB, PDF/DOC/DOCX/TXT)
- targetLanguage: "en"
- mode: "translate" | "summarize"
```

### Follow-up Question

```
POST /api/v1/voice/interactions/:interactionId/follow-up
Content-Type: application/json

{
  "questionId": "question_123"
}
```

## Railway Deployment

### 1. Create Railway Project

1. Go to [Railway](https://railway.app)
2. Create new project
3. Connect your GitHub repository
4. Select the repository root (Railway will detect Node.js)

### 2. Add PostgreSQL Database

1. In Railway dashboard, click "New" → "Database" → "Add PostgreSQL"
2. Railway automatically provides `DATABASE_URL` environment variable

### 3. Configure Environment Variables

In Railway dashboard, add these environment variables:

```
GEMINI_API_KEY=your_gemini_api_key_here
NODE_ENV=production
PORT=3000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
ALLOWED_ORIGINS=https://your-flutter-app-domain.com
```

**Note**: `DATABASE_URL` is automatically set by Railway when you add PostgreSQL.

### 4. Deploy

Railway will automatically:
- Detect Node.js project
- Run `npm ci` (install dependencies)
- Run `npm run build` (build TypeScript)
- Run `postinstall` script (database migrations)
- Run `npm start` (start server)

### 5. Get Your API URL

After deployment, Railway provides a public URL like:
```
https://your-project.up.railway.app
```

Use this URL in your Flutter app's `.env` file:
```
API_BASE_URL=https://your-project.up.railway.app
```

## Project Structure

```
backend/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/
│   │   └── env.ts           # Environment configuration
│   ├── db/
│   │   ├── schema.ts        # Drizzle schema definitions
│   │   ├── index.ts         # Database connection
│   │   ├── migrate.ts        # Migration runner
│   │   └── migrations/      # SQL migration files
│   ├── routes/
│   │   ├── voice.ts         # Voice endpoints
│   │   ├── vision.ts         # Vision endpoints
│   │   ├── documents.ts     # Document endpoints
│   │   └── health.ts         # Health check
│   ├── services/
│   │   └── geminiService.ts  # Gemini API integration
│   ├── middleware/
│   │   ├── rateLimiter.ts    # Rate limiting
│   │   ├── errorHandler.ts   # Error handling
│   │   └── validator.ts      # Request validation
│   └── utils/
│       └── logger.ts         # Logging utility
├── drizzle/                  # Generated migrations (gitignored)
├── dist/                     # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── drizzle.config.ts         # Drizzle configuration
├── railway.json             # Railway deployment config
├── nixpacks.toml            # Railway build config
└── README.md
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | `3000` |
| `NODE_ENV` | Environment | No | `development` |
| `GEMINI_API_KEY` | Gemini API key | **Yes** | - |
| `DATABASE_URL` | PostgreSQL connection string | **Yes** (production) | - |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | No | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | No | `100` |
| `LOG_LEVEL` | Logging level | No | `info` |
| `ALLOWED_ORIGINS` | CORS allowed origins | No | `*` |

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run db:generate` - Generate database migrations
- `npm run db:migrate` - Run database migrations
- `npm run db:studio` - Open Drizzle Studio (database GUI)
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run format` - Format code with Prettier

## Database Operations

### View Database Schema
```bash
npm run db:studio
```

Opens Drizzle Studio in browser to view and edit database.

### Create New Migration
1. Edit `src/db/schema.ts`
2. Run `npm run db:generate`
3. Review generated SQL in `drizzle/` folder
4. Run `npm run db:migrate` to apply

### Reset Database (Development Only)
```bash
# Drop and recreate database
# Then run migrations
npm run db:migrate
```

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```

## Security

- ✅ Helmet.js for security headers
- ✅ CORS configuration
- ✅ Rate limiting
- ✅ Input validation (Zod)
- ✅ Error handling
- ✅ Environment variable validation
- ✅ SQL injection protection (Drizzle ORM)

## Monitoring

- Logs are written to stdout (Railway captures these)
- Health check endpoint: `/health`
- Error tracking via Winston logger

## Support

For issues or questions:
- Backend Architecture: See main repo `docs/backend_architecture.md`
- Gemini Interactions API: See main repo `docs/gemini_interactions_api.md`
- Agent Prompt: `AGENT_PROMPT.md`
