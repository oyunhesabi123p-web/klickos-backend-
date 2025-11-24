// api/user.js (GÜNCELLENMİŞ VERSİYON)
import { createClient } from '@supabase/supabase-js';

// ⚠️ YENİ DEĞİŞKEN ADLARI: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY
// Bu değişkenleri Vercel'deki Environment Variables kısmına eklemeyi unutmayın!
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 

// Supabase istemcisini Service Role Key ile oluştur
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        // Sunucu tarafında oturum depolamasını devre dışı bırak
        persistSession: false 
    }
});

// --- 1. ANA HANDLER FONKSİYONU ---
export default async function handler(req, res) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        // Bu bloğa ulaşırsanız, Vercel'in kendi hatası yerine daha temiz bir hata alırsınız.
        console.error("Supabase Environment Variables not set!");
        return res.status(500).json({ message: 'Server configuration error: Supabase keys missing.' });
    }

    // Gelen isteğin yolunu al
    const path = req.url.split('?')[0]; 

    // --- UÇ NOKTALARI YÖNLENDİRME (Aynı Kaldı) ---

    if (path.includes('/api/user')) { 
        if (req.method === 'GET') {
            return await getUserData(req, res);
        } else if (req.method === 'POST') {
            return await saveUserData(req, res);
        }
    } 
    else if (path.includes('/api/frens/list')) { 
         if (req.method === 'GET') {
            return await getFrensList(req, res);
        }
    } 
    else if (path.includes('/api/boosts/buy')) {
        if (req.method === 'POST') {
            return await buyBoosts(req, res);
        }
    }
    
    // Geçersiz yol veya metot
    else {
        res.status(404).json({ message: 'Not Found' });
    }
}

// --- 2. KULLANICI VERİSİ FONKSİYONLARI (Günlük sıfırlama mantığı aynı kaldı) ---

// Kullanıcı verisini çeken ve günlük sıfırlama yapan fonksiyon
async function getUserData(req, res) {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ message: 'User ID required' });
    }

    // 1. Kullanıcıyı Veritabanından çek (usersq tablosu)
    // ... (Kalan kod aynı, sorunsuz çalışıyordu)
    let { data: user, error } = await supabase
        .from('usersq') 
        .select('*')
        .eq('id', userId)
        .single();
    
    // ... (Kullanıcı oluşturma ve boost sıfırlama kısmı aynı)
    
    // ...
    
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

// Kullanıcı verisini kaydeden fonksiyon (Aynı kaldı)
async function saveUserData(req, res) {
    const { userId, score, currentEnergy, turboCount, energyFullCount } = req.body;
    
    if (!userId || score === undefined || currentEnergy === undefined) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

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


// --- 3. FRENS LİSTESİ FONKSİYONU (Aynı kaldı) ---
// ... (Kod aynı)


// --- 4. BOOSTS FONKSİYONU (GÜNCELLEME BURADA) ---

// Boost Satın Alma/Kullanma
async function buyBoosts(req, res) {
    const { userId, itemName, price } = req.body;
    if (!userId || !itemName) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // 1. Ücretsiz Boost Kullanımı (Turbo veya Full Energy)
    if (price === 0) { 
        let columnToDecrement = null;
        if (itemName === "turbo") {
            columnToDecrement = 'turbo_count';
        } else if (itemName === "energyFull") {
            columnToDecrement = 'energy_full_count';
        } else {
             return res.status(403).json({ success: false, message: 'Invalid boost' });
        }
        
        // 🚨 Atomik Güncelleme: Count > 0 ise azalt
        const { data, error: updateError } = await supabase
            .from('usersq')
            .update({ 
                [columnToDecrement]: supabase.raw(`${columnToDecrement} - 1`) 
            })
            .eq('id', userId)
            .gte(columnToDecrement, 1) // Count'un 1'den büyük veya eşit olduğunu kontrol et
            .select(`${columnToDecrement}`) // Güncellenmiş değeri çekmek için select eklendi
            .single();

        if (updateError || !data) {
             // Ya DB hatası ya da gte koşulu sağlanamadı (Count 0'dı)
             return res.status(403).json({ success: false, message: 'Daily limit reached or error during update' });
        }
        
        // Başarılı sonuç döndür
        res.status(200).json({ 
            success: true, 
            message: 'Boost used successfully',
            updatedCount: data[columnToDecrement]
        });


    } 
    // 2. Yükseltme Satın Alma (Multitap vb.)
    else if (price > 0) {
        let updateData = {};

        if (itemName === "multiClick") {
            // 🚨 Atomik Güncelleme: Skoru düşür ve level'ı artır
            // Bu tek işlemde yapılır, Race Condition önlenir.
            updateData = { 
                score: supabase.raw(`score - ${price}`),
                multi_level: supabase.raw('multi_level + 1')
            };
        } else {
             return res.status(400).json({ success: false, message: 'Invalid item to buy' });
        }
        
        const { data, error: updateError } = await supabase
            .from('usersq') 
            .update(updateData)
            .eq('id', userId)
            .gte('score', price) // Sadece skor yeterliyse güncelle
            .select('score, multi_level')
            .single();

        if (updateError || !data) {
            // Ya DB hatası ya da gte koşulu sağlanamadı (Skor Yetersiz)
            return res.status(403).json({ success: false, message: 'Insufficient score or error during update' });
        }
        
        // Başarılı sonuç döndür
        res.status(200).json({ 
            success: true, 
            newScore: data.score, // Yeni skor ve level DB'den geldi
            newLevel: data.multi_level,
            message: 'Upgrade successful'
        });
    } else {
         return res.status(400).json({ success: false, message: 'Invalid price' });
    }
}
