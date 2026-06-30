import { MongoClient, type MongoClientOptions } from 'mongodb'

let client: MongoClient | null = null
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 8000

function normalizeMongoHost(host: string) {
  if (host.startsWith('mongodb+srv://')) return host.replace('mongodb+srv://', '').split('/')[0]
  if (host.startsWith('mongodb://')) return host.replace('mongodb://', '').split('/')[0]
  return host.split('/')[0]
}

export function getMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI
  const host = process.env.MONGODB_HOST
  const username = process.env.MONGODB_USERNAME
  const password = process.env.MONGODB_PASSWORD
  if (!host || !username || !password) return null
  const params = process.env.MONGODB_OPTIONS ?? 'retryWrites=true&w=majority&appName=musicRAG'
  const normalizedHost = normalizeMongoHost(host)
  const encodedUser = encodeURIComponent(username)
  const encodedPassword = encodeURIComponent(password)
  return `mongodb+srv://${encodedUser}:${encodedPassword}@${normalizedHost}/?${params.replace(/^\?/, '')}`
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function mongoClientOptions(): MongoClientOptions {
  const serverSelectionTimeoutMS = envNumber(
    'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
    DEFAULT_SERVER_SELECTION_TIMEOUT_MS
  )
  return {
    serverSelectionTimeoutMS,
    connectTimeoutMS: envNumber('MONGODB_CONNECT_TIMEOUT_MS', serverSelectionTimeoutMS)
  }
}

export function publicMongoError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/MONGODB_URI|MONGODB_HOST|MONGODB_USERNAME|MONGODB_PASSWORD/.test(message)) {
    return 'Database runtime env is missing. Set the production database connection variables before using retrieval.'
  }
  if (/MongoServerSelectionError|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|27017|server selection/i.test(message)) {
    return 'Database connection timed out from Vercel. Allow Vercel egress in the database network access settings, or enable Vercel Secure Compute/static egress and allow that address.'
  }
  return message
}

export async function getMongoClient() {
  const uri = getMongoUri()
  if (!uri) {
    throw new Error('MONGODB_URI or MONGODB_HOST/MONGODB_USERNAME/MONGODB_PASSWORD is required')
  }
  if (!client) {
    client = new MongoClient(uri, mongoClientOptions())
  }
  await client.connect()
  return client
}

export async function getDb() {
  const mongo = await getMongoClient()
  return mongo.db(process.env.MONGODB_DB ?? 'music_rag')
}
