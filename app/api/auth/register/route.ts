import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import { signToken } from '@/lib/jwt';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.name) {
    return NextResponse.json({ error: 'email, password and name are required' }, { status: 400 });
  }

  await connectDB();

  const existing = await User.findOne({ email: body.email.toLowerCase() });
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await User.create({ email: body.email, passwordHash, name: body.name });

  const token = await signToken({ userId: user._id.toString(), email: user.email, name: user.name });

  const res = NextResponse.json({ user: { id: user._id, email: user.email, name: user.name } });
  res.cookies.set('pulse_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 7, path: '/' });
  return res;
}
