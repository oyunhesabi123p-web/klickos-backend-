// api/user.js dosyası
import { createClient } from '@supabase/supabase-js';

// ⚠️ GÜVENLİK UYARISI: Bu anahtarlar canlı projelerde gizlenmelidir.
// Test aşaması için geçici olarak buraya eklenmiştir.
const SUPABASE_URL = 'https://ocdmkjfgotpdclneapke.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jZG1ramZnb3RwZGNsbmVhcGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5ODY4NDEsImV4cCI6MjA3OTU2Mjg0MX0.94Y8tbXYdrhji7VMUaWZJSY6GuOIlJ5AVZt7Xa_A0Ms';

// Supabase istemcisini oluştur
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Vercel Serverless Function yapısı:
export default async function handler(req, res) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        // Bu kontrol aslında sabit değerlerde gereksiz, ama güvenlik hatırlatması olarak kalabilir.
        return res.status(500).json({ message: 'Server configuration error.' });
    }

    if (req.method === 'GET') {
        return await getUserData(req, res);
    } else if (req.method === 'POST') {
        return await saveUserData(req, res);
    } else {
        res.status(405).json({ message: 'Method Not Allowed' });
    }
}

// Kullanıcı verisini çeken fonksiyon
async function getUserData(req, res) {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ message: 'User ID required' });
    }

    // 1. Kullanıcıyı Veritabanından çek (usersq tablosu)
    let { data: user, error } = await supabase
        .from('usersq') 
        .select('*')
        .eq('id', userId)
        .single();

    if (error && error.code !== 'PGRST116') { 
        console.error("Supabase çekme hatası:", error);
        return res.status(500).json({ message: 'Database error' });
    }

    // 2. Kullanıcı yoksa, yeni bir kayıt oluştur
    if (!user) {
        const { data: newUser, error: createError } = await supabase
            .from('usersq') 
            .insert([{ id: userId }]) 
            .select()
            .single();
        
        if (createError) {
             console.error("Supabase oluşturma hatası:", createError);
             return res.status(500).json({ message: 'Error creating user' });
        }
        user = newUser;
    }
    
    // 3. Daily Boost Reset Kontrolü
    const today = new Date().toDateString();
    const lastReset = new Date(user.last_boost_reset).toDateString();

    if (lastReset !== today) {
        // Yeni gün, boostları sıfırla
        const { error: updateError } = await supabase
            .from('usersq') 
            .update({ 
                turbo_count: 6, 
                energy_full_count: 12, 
                last_boost_reset: new Date() 
            })
            .eq('id', userId);

        if (updateError) {
             console.error("Boost sıfırlama hatası:", updateError);
        }
        user.turbo_count = 6;
        user.energy_full_count = 12;
    }

    // 4. Frontend'e veriyi gönder
    res.status(200).json({
        score: user.score || 0,
        currentEnergy: user.current_energy,
        multiClickLevel: user.multi_level,
        turboCount: user.turbo_count,
        energyFullCount: user.energy_full_count,
        maxEnergy: 1000 
    });
}

// Kullanıcı verisini kaydeden fonksiyon
async function saveUserData(req, res) {
    const { userId, score, currentEnergy, turboCount, energyFullCount } = req.body;
    
    if (!userId || score === undefined || currentEnergy === undefined) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    // Veriyi Supabase'e kaydet
    const { error } = await supabase
        .from('usersq') 
        .update({ 
            score: score, 
            current_energy: currentEnergy,
            turbo_count: turboCount,
            energy_full_count: energyFullCount
        })
        .eq('id', userId);

    if (error) {
        console.error("Supabase kaydetme hatası:", error);
        return res.status(500).json({ message: 'Database error on save' });
    }

    res.status(200).json({ success: true });
}
