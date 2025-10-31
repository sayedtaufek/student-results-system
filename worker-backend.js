import { Hono } from 'hono'
import { cors } from '@hono/cors'
import { sign, verify } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

// Initialize Hono app
const app = new Hono()

// CORS configuration
app.use('/*', cors({
  origin: ['https://yourdomain.com', 'https://www.yourdomain.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Types and Schemas
const StudentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  student_id: z.string().min(1),
  school: z.string().min(1),
  educational_stage: z.string().min(1),
  region: z.string().optional(),
  subjects: z.array(z.object({
    name: z.string(),
    score: z.number(),
    max_score: z.number(),
    percentage: z.number()
  })),
  average: z.number(),
  grade: z.string(),
  created_at: z.string(),
  updated_at: z.string()
})

// Database helper functions
class DatabaseService {
  constructor(db) {
    this.db = db
  }

  async getStudents(limit = 50, offset = 0) {
    const query = `
      SELECT * FROM students 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `
    const { results } = await this.db.prepare(query).bind(limit, offset).all()
    return results
  }

  async searchStudents(searchTerm, stageId = null, region = null) {
    let query = `
      SELECT * FROM students 
      WHERE (name LIKE ? OR student_id LIKE ?)
    `
    const params = [`%${searchTerm}%`, `%${searchTerm}%`]

    if (stageId) {
      query += ` AND educational_stage = ?`
      params.push(stageId)
    }

    if (region) {
      query += ` AND region = ?`
      params.push(region)
    }

    query += ` ORDER BY name LIMIT 100`

    const { results } = await this.db.prepare(query).bind(...params).all()
    return results
  }

  async getStudentById(id) {
    const query = `SELECT * FROM students WHERE id = ?`
    const { results } = await this.db.prepare(query).bind(id).first()
    return results
  }

  async createStudent(studentData) {
    const id = uuidv4()
    const now = new Date().toISOString()
    
    const query = `
      INSERT INTO students (
        id, name, student_id, school, educational_stage, 
        region, subjects, average, grade, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    
    await this.db.prepare(query).bind(
      id,
      studentData.name,
      studentData.student_id,
      studentData.school,
      studentData.educational_stage,
      studentData.region,
      JSON.stringify(studentData.subjects),
      studentData.average,
      studentData.grade,
      now,
      now
    ).run()

    return { id, ...studentData, created_at: now, updated_at: now }
  }

  async getSiteSettings() {
    const query = `SELECT * FROM site_settings LIMIT 1`
    const result = await this.db.prepare(query).first()
    return result || {
      site_name: "نظام الاستعلام الذكي عن النتائج",
      site_description: "نظام متطور للبحث والاستعلام عن النتائج التعليمية",
      primary_color: "#3B82F6",
      secondary_color: "#1E40AF",
      accent_color: "#F59E0B"
    }
  }

  async updateSiteSettings(settings) {
    const existing = await this.getSiteSettings()
    const now = new Date().toISOString()

    if (existing.id) {
      const query = `
        UPDATE site_settings 
        SET site_name = ?, site_description = ?, primary_color = ?, 
            secondary_color = ?, accent_color = ?, updated_at = ?
        WHERE id = ?
      `
      await this.db.prepare(query).bind(
        settings.site_name || existing.site_name,
        settings.site_description || existing.site_description,
        settings.primary_color || existing.primary_color,
        settings.secondary_color || existing.secondary_color,
        settings.accent_color || existing.accent_color,
        now,
        existing.id
      ).run()
    } else {
      const id = uuidv4()
      const query = `
        INSERT INTO site_settings (
          id, site_name, site_description, primary_color, 
          secondary_color, accent_color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      await this.db.prepare(query).bind(
        id,
        settings.site_name,
        settings.site_description,
        settings.primary_color,
        settings.secondary_color,
        settings.accent_color,
        now,
        now
      ).run()
    }

    return await this.getSiteSettings()
  }
}

// Authentication middleware
const authMiddleware = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!token) {
    return c.json({ detail: 'Token required' }, 401)
  }

  try {
    const decoded = verify(token, c.env.JWT_SECRET)
    c.set('user', decoded)
    await next()
  } catch (error) {
    return c.json({ detail: 'Invalid token' }, 401)
  }
}

// API Routes

// Public endpoints
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Get site settings (public)
app.get('/api/site-settings', async (c) => {
  const db = new DatabaseService(c.env.DB)
  const settings = await db.getSiteSettings()
  return c.json(settings)
})

// Search students (public)
app.post('/api/search', async (c) => {
  try {
    const body = await c.req.json()
    const { query, educational_stage_id, region } = body

    if (!query || query.length < 2) {
      return c.json({ detail: 'Search query too short' }, 400)
    }

    const db = new DatabaseService(c.env.DB)
    const results = await db.searchStudents(query, educational_stage_id, region)
    
    return c.json({ results, total: results.length })
  } catch (error) {
    console.error('Search error:', error)
    return c.json({ detail: 'Search failed' }, 500)
  }
})

// Get student by ID (public)
app.get('/api/students/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const db = new DatabaseService(c.env.DB)
    const student = await db.getStudentById(id)
    
    if (!student) {
      return c.json({ detail: 'Student not found' }, 404)
    }

    // Parse subjects JSON
    if (student.subjects && typeof student.subjects === 'string') {
      student.subjects = JSON.parse(student.subjects)
    }

    return c.json(student)
  } catch (error) {
    console.error('Get student error:', error)
    return c.json({ detail: 'Failed to get student' }, 500)
  }
})

// Admin login
app.post('/api/admin/login', async (c) => {
  try {
    const { username, password } = await c.req.json()

    // Default admin credentials (change in production)
    if (username === 'admin' && password === 'admin123') {
      const token = sign(
        { username, role: 'admin' },
        c.env.JWT_SECRET,
        { expiresIn: '24h' }
      )
      
      return c.json({ access_token: token, token_type: 'bearer' })
    }

    return c.json({ detail: 'Invalid credentials' }, 401)
  } catch (error) {
    return c.json({ detail: 'Login failed' }, 500)
  }
})

// Protected admin endpoints
app.use('/api/admin/*', authMiddleware)

// Get all students (admin)
app.get('/api/admin/students', async (c) => {
  const db = new DatabaseService(c.env.DB)
  const students = await db.getStudents()
  return c.json(students)
})

// Update site settings (admin)
app.put('/api/admin/site-settings', async (c) => {
  try {
    const settings = await c.req.json()
    const db = new DatabaseService(c.env.DB)
    const updatedSettings = await db.updateSiteSettings(settings)
    return c.json(updatedSettings)
  } catch (error) {
    console.error('Update settings error:', error)
    return c.json({ detail: 'Failed to update settings' }, 500)
  }
})

// Subscription endpoints
app.post('/api/subscribe', async (c) => {
  try {
    const body = await c.req.json()
    const { email, name, phone, educational_stage, region } = body

    if (!email || !name) {
      return c.json({ detail: 'Email and name are required' }, 400)
    }

    const db = new DatabaseService(c.env.DB)
    const id = uuidv4()
    const now = new Date().toISOString()

    const query = `
      INSERT INTO subscribers (
        id, email, name, phone, educational_stage, 
        region, subscription_date, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    await db.db.prepare(query).bind(
      id, email, name, phone, educational_stage, 
      region, now, true, now
    ).run()

    return c.json({ 
      id, email, name, phone, educational_stage, 
      region, subscription_date: now, is_active: true 
    })
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return c.json({ detail: 'البريد الإلكتروني مسجل مسبقاً' }, 400)
    }
    console.error('Subscribe error:', error)
    return c.json({ detail: 'خطأ في الاشتراك' }, 500)
  }
})

// Error handling
app.notFound((c) => {
  return c.json({ detail: 'Endpoint not found' }, 404)
})

app.onError((err, c) => {
  console.error('Worker error:', err)
  return c.json({ detail: 'Internal server error' }, 500)
})

export default app