import { MongoClient } from 'mongodb'

let client: MongoClient | null = null

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

export async function getMongoClient() {
  const uri = getMongoUri()
  if (!uri) {
    throw new Error('MONGODB_URI or MONGODB_HOST/MONGODB_USERNAME/MONGODB_PASSWORD is required')
  }
  if (!client) {
    client = new MongoClient(uri)
  }
  await client.connect()
  return client
}

export async function getDb() {
  const mongo = await getMongoClient()
  return mongo.db(process.env.MONGODB_DB ?? 'music_rag')
}
