import { MongoClient } from 'mongodb'

let client: MongoClient | null = null

export async function getMongoClient() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required')
  }
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI)
  }
  await client.connect()
  return client
}

export async function getDb() {
  const mongo = await getMongoClient()
  return mongo.db(process.env.MONGODB_DB ?? 'music_rag')
}

