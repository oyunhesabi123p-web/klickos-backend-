// api/user.js dosyası
import { createClient } from '@supabase/supabase-js';

// ⚠️ GÜVENLİK UYARISI: Sabit anahtarlar yerine Vercel Ortam Değişkenleri kullanıldı.
// Vercel'deki "Environment Variables" ayarlarında bu iki değişkenin ayarlandığından emin ol.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Supabase istemcisini oluştur
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 1. ANA HANDLER FONKSİYONU ---
export default async function handler(req, res) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error("Supabase Environment Variables not set!");
        return res.status(500).json({ message: 'Server configuration error: Supabase keys missing.' });
    }

    // Gelen isteğin yolunu al (örneğin: /api/user, /api/frens/list, /api/boosts/buy)
    const path = req.url.split('?')[0]; 

    // --- UÇ NOKTALARI YÖNLENDİRME ---

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

// --- 2. KULLANICI VERİSİ FONKSİYONLARI ---

// Kullanıcı verisini çeken ve günlük sıfırlama yapan fonksiyon
async function getUserData(req, res) {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ message: 'User ID required' });
    }

    // 1. Kullanıcıyı Veritabanından çek (usersq tablosu)
    let { data: user, error } = await supabase
        .from('usersq') // 🟢 usersq tablosu
        .select('*')
        .eq('id', userId)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = Kayıt bulunamadı
        console.error("Supabase çekme hatası:", error);
        return res.status(500).json({ message: 'Database error' });
    }

    // 2. Kullanıcı yoksa, yeni bir kayıt oluştur
    if (!user) {
        const { data: newUser, error: createError } = await supabase
            .from('usersq') // 🟢 usersq tablosu
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
            .from('usersq') // 🟢 usersq tablosu
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

    const { error } = await supabase
        .from('usersq') // 🟢 usersq tablosu
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


// --- 3. FRENS LİSTESİ FONKSİYONU ---

// Frens Listesini Çekme
async function getFrensList(req, res) {
    const inviterId = req.query.inviterId;
    if (!inviterId) {
        return res.status(400).json({ message: 'Inviter ID required' });
    }

    // Davet edilen kişileri çek
    let { data: frens, error } = await supabase
        .from('usersq') // 🟢 usersq tablosu
        .select('id, score, multi_level, inviter_id') 
        .eq('inviter_id', inviterId)
        .order('score', { ascending: false }); 

    if (error) {
        console.error("Frens listesi çekilirken Supabase hatası:", error);
        return res.status(500).json({ message: 'Database error fetching frens' });
    }
    
    // Frontend'e uygun formatta veri hazırla
    const frensData = frens.map((fren, index) => ({
        name: `User-${fren.id.substring(0, 5)}`, 
        score: fren.score,
        rank: index < 10 ? 'Gold' : index < 50 ? 'Silver' : 'Bronze', 
        commission: Math.floor(fren.score * 0.10) 
    }));


    res.status(200).json({ success: true, frens: frensData });
}


// --- 4. BOOSTS FONKSİYONU ---

// Boost Satın Alma/Kullanma
async function buyBoosts(req, res) {
    const { userId, itemName, price } = req.body;
    if (!userId || !itemName) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // 1. Kullanıcının mevcut durumunu çek
    let { data: user, error } = await supabase
        .from('usersq') // 🟢 usersq tablosu
        .select('*')
        .eq('id', userId)
        .single();

    if (error || !user) {
        return res.status(500).json({ success: false, message: 'User not found or database error' });
    }

    let updateData = {};
    let newScore = user.score;
    let newLevel = user.multi_level;

    // A. Ücretsiz Boost Kullanımı (Turbo veya Full Energy)
    if (price === 0) { 
        if (itemName === "turbo" && user.turbo_count > 0) {
            updateData.turbo_count = user.turbo_count - 1;
            
        } else if (itemName === "energyFull" && user.energy_full_count > 0) {
            updateData.energy_full_count = user.energy_full_count - 1;
            
        } else {
             return res.status(403).json({ success: false, message: 'Daily limit reached or invalid boost' });
        }
    } 
    // B. Yükseltme Satın Alma (Multitap vb.)
    else if (price > 0) {
        if (newScore < price) {
            return res.status(403).json({ success: false, message: 'Insufficient score' });
        }
        
        newScore -= price; 
        updateData.score = newScore; 

        if (itemName === "multiClick") {
            newLevel += 1; // Level'i artır
            updateData.multi_level = newLevel;
        } 
        // Diğer boostlar buraya eklenebilir
    }
    
    // 2. Veritabanını güncelle
    const { error: updateError } = await supabase
        .from('usersq') // 🟢 usersq tablosu
        .update(updateData)
        .eq('id', userId);

    if (updateError) {
        console.error("Boost güncelleme hatası:", updateError);
        return res.status(500).json({ success: false, message: 'Database error on update' });
    }
    
    // 3. Başarılı sonuç döndür
    res.status(200).json({ 
        success: true, 
        newScore: newScore,
        newLevel: newLevel,
        message: 'Boost operation successful'
    });
}
  
