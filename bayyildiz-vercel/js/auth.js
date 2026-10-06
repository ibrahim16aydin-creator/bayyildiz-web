let isLoginMode = true;

function initAuth() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user && !user.isAnonymous) {
                if (window.App && typeof window.App.syncUserData === 'function') {
                    window.App.syncUserData(user.uid);
                }
                showProfileSection(user.email);
            } else {
                showAuthSection();
            }
        });
    } else {
        setTimeout(initAuth, 50);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});

window.toggleAuthMode = function() {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-submit-btn');
    const toggleLink = document.getElementById('auth-toggle-link');
    const toggleSpan = toggleLink.previousElementSibling;
    const errorEl = document.getElementById('auth-error');
    const extraFields = document.getElementById('auth-extra-fields');
    const nameInput = document.getElementById('auth-name');
    const phoneInput = document.getElementById('auth-phone');
    
    errorEl.style.display = 'none';
    const emailLabel = document.getElementById('auth-email-label');
    
    if (isLoginMode) {
        title.innerText = "Giriş Yap";
        btn.innerText = "Giriş Yap";
        if (toggleSpan) toggleSpan.innerText = "Hesabınız yok mu?";
        toggleLink.innerHTML = "Kayıt Olun";
        if (extraFields) extraFields.style.display = 'none';
        if (nameInput) nameInput.required = false;
        if (phoneInput) phoneInput.required = false;
        if (emailLabel) emailLabel.innerText = "E-posta Adresi";
    } else {
        title.innerText = "Kayıt Ol";
        btn.innerText = "Kayıt Ol";
        if (toggleSpan) toggleSpan.innerText = "Zaten hesabınız var mı?";
        toggleLink.innerHTML = "Giriş Yapın";
        if (extraFields) extraFields.style.display = 'block';
        if (nameInput) nameInput.required = true;
        if (phoneInput) phoneInput.required = true;
        if (emailLabel) emailLabel.innerText = "E-posta Adresi";
    }
}

window.handleAuthSubmit = async function() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name') ? document.getElementById('auth-name').value : '';
    const phone = document.getElementById('auth-phone') ? document.getElementById('auth-phone').value : '';
    const errorEl = document.getElementById('auth-error');
    const btn = document.getElementById('auth-submit-btn');
    
    errorEl.style.display = 'none';
    const originalBtnText = btn.innerText;
    btn.innerText = "Lütfen bekleyin...";
    btn.disabled = true;
    
    try {
        if (isLoginMode) {
            let loginEmail = email.trim();
            if (!loginEmail.includes('@')) {
                // GÜVENLİK: Telefon numarası ile giriş artık desteklenmiyor.
                // Eski yöntem tüm müşteri veritabanını client'a çekiyordu.
                throw { 
                    code: 'auth/phone-not-supported', 
                    message: 'Telefon numarası ile giriş yapılamaz. Lütfen kayıt olduğunuz e-posta adresinizi kullanın.' 
                };
            }
            
            await firebase.auth().signInWithEmailAndPassword(loginEmail, password);
            if(window.App && window.App.toast) App.toast("Başarıyla giriş yapıldı!", "success");
        } else {
            const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
            if (userCredential.user) {
                try {
                    await userCredential.user.sendEmailVerification();
                    if(window.App && window.App.toast) {
                        App.toast("Kayıt başarılı! Lütfen e-postanıza gelen onay linkine tıklayın.", "info");
                    } else {
                        alert("Kayıt başarılı! Lütfen e-postanıza gelen onay linkine tıklayın.");
                    }
                } catch (err) {
                    console.error("Doğrulama e-postası gönderilemedi:", err);
                }
            }
            
            // Kullanıcıyı veritabanındaki customers düğümüne kaydet
            if (userCredential.user) {
                // Stok programı App.DATA_PATH + '/customers' altına bakıyor
                let dbPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + userCredential.user.uid;
                
                try {
                    await firebase.database().ref(dbPath).set({
                        name: name,
                        isimSoyisim: name,
                        adSoyad: name, // Uyumluluk için
                        telefon: phone,
                        phone: phone,      // Uyumluluk için
                        email: email,
                        kayitTarihi: new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                        status: 'new',
                        source: 'web_register'
                    });
                } catch(dbErr) {
                    console.error("Müşteri bilgisi veritabanına yazılamadı:", dbErr);
                }
            }
            
            /* Removed default toast because email verification toast is used */
        }
    } catch (error) {
        let msg = "Bir hata oluştu.";
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
            msg = "Giriş bilgileri hatalı.";
        } else if (error.code === 'auth/phone-not-supported') {
            msg = error.message;
        } else if (error.code === 'auth/email-already-in-use') {
            msg = "Bu e-posta adresi zaten kullanımda.";
        } else if (error.code === 'auth/weak-password') {
            msg = "Şifre çok zayıf. En az 6 karakter olmalı.";
        } else {
            msg = error.message;
        }
        errorEl.innerText = msg;
        errorEl.style.display = 'block';
    } finally {
        btn.innerText = originalBtnText;
        btn.disabled = false;
    }
}

window.handleLogout = async function() {
    try {
        localStorage.removeItem('bayyildiz_history');
        localStorage.removeItem('bayyildiz_favorites');
        localStorage.removeItem('bayyildiz_cart');
        localStorage.removeItem('bayyildiz_cached_username');
        if (window.App) {
            window.App.favorites = [];
            window.App.userDbKey = null; // FIX: bir sonraki girişte bayat/yanlış dbKey kullanılmasın
            if (typeof window.App.renderDashboard === 'function') {
                window.App.renderDashboard();
            }
        }
        
        await firebase.auth().signOut();
        if(window.App && window.App.toast) App.toast("Çıkış yapıldı", "info");

    } catch(err) {
        console.error(err);
    }
}

function showAuthSection() {
    const authSec = document.getElementById('auth-section');
    const profSec = document.getElementById('profile-section');
    const subtitle = document.getElementById('profile-subtitle');
    
    if(authSec) authSec.style.display = 'block';
    if(profSec) profSec.style.display = 'none';
    if(subtitle) subtitle.style.display = 'none';
    
    document.querySelectorAll('.profile-dropdown').forEach(dropdown => {
        dropdown.innerHTML = `
            <a href="hesabim.html?tab=login" class="dropdown-link">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
                Giriş Yap
            </a>
            <a href="hesabim.html?tab=register" class="dropdown-link">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                Kayıt Ol
            </a>
        `;
    });
}

function showProfileSection(email) {
    const authSec = document.getElementById('auth-section');
    const profSec = document.getElementById('profile-section');
    const emailDisp = document.getElementById('user-email-display');
    const subtitle = document.getElementById('profile-subtitle');
    
    if(authSec) authSec.style.display = 'none';
    if(profSec) profSec.style.display = 'block';
    if(subtitle) subtitle.style.display = 'block';
    
    document.querySelectorAll('.profile-dropdown').forEach(dropdown => {
        dropdown.innerHTML = `
            <a href="hesabim.html" class="dropdown-link">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                Hesabım
            </a>
            <a href="#" onclick="if(typeof handleLogout === 'function') { handleLogout(); } else if(firebase && firebase.auth) { firebase.auth().signOut().then(()=>{window.location.reload();}); } return false;" class="dropdown-link" style="color: #ef4444;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                Çıkış
            </a>
        `;
    });
    
    if(emailDisp) {
    const cachedName = localStorage.getItem('bayyildiz_cached_username');
    if (cachedName) {
        emailDisp.innerText = cachedName;
    } else {
        emailDisp.innerText = "Yükleniyor...";
    }
    
    const user = firebase.auth().currentUser;
    if(user) {
        let dbPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers/' + user.uid;
        firebase.database().ref(dbPath).once('value').then(async snap => {
            let userName = null;
            let data = null;
            if(snap.exists()){ data = snap.val(); }
            
            if(data) {
                userName = data.name || data.isimSoyisim || data.adSoyad || data["ad soyad"] || data.ad_soyad || data.displayName || data.kullaniciAdi;
            }
            
            // Eğer UID altında isim bulunamadıysa (sadece geçmiş/history varsa vs.) legacy aramaya geç
            if(!userName && user.email) {
                let baseCustomersPath = (window.App && window.App.DATA_PATH ? window.App.DATA_PATH : '_bayyildiz_secure_v1_A9xK2mP8') + '/customers';
                try {
                    let querySnap = await firebase.database().ref(baseCustomersPath).orderByChild('email').equalTo(user.email).once('value');
                    if (querySnap.exists()) {
                        let results = querySnap.val();
                        let firstKey = Object.keys(results)[0];
                        let legacyData = results[firstKey];
                        userName = legacyData.name || legacyData.isimSoyisim || legacyData.adSoyad || legacyData["ad soyad"] || legacyData.ad_soyad || legacyData.displayName || legacyData.kullaniciAdi;
                    }
                } catch(e) {
                    console.error("Legacy query error:", e);
                }
            }
            
            if(!userName && user.displayName) { userName = user.displayName; }
            if(userName) {
                emailDisp.innerText = userName;
                localStorage.setItem('bayyildiz_cached_username', userName);
            } else {
                // Eger veritabanından isim cekilemediyse (ornek: KVKK onayı yoksa)
                // ekranda baska birinin ismi kalmasın diye temizliyoruz.
                localStorage.removeItem('bayyildiz_cached_username');
                emailDisp.innerText = "Değerli Müşterimiz";
                
                // KVKK uyarı metni ekle
                if (user && user.emailVerified === false) {
                    const profileSubtitle = document.getElementById('profile-subtitle');
                    if (profileSubtitle) {
                        profileSubtitle.innerHTML = '<span style="color: #ef4444; font-weight: 500; font-size: 0.95rem;">🔒 Geçmiş siparişlerinizi ve kişisel bilgilerinizi görmek için lütfen e-postanıza gönderilen onay linkine tıklayın.</span>';
                    }
                }
            }
        }).catch(err => {
            if(!cachedName) emailDisp.innerText = "Değerli Müşterimiz";
        });
    } else {
        if(!cachedName) emailDisp.innerText = "Değerli Müşterimiz";
    }
}
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if(params.get('tab') === 'register') {
        setTimeout(() => {
            if(typeof window.toggleAuthMode === 'function' && typeof isLoginMode !== 'undefined' && isLoginMode) {
                window.toggleAuthMode();
            }
        }, 100);
    }
});


// ==========================================================
// Mobil/dokunmatik cihazlarda profil menüsü
// Masaüstünde menü hover ile açılıyor; dokunmatik cihazlarda hover olmadığı için
// ikona dokunmak direkt hesabim.html'e götürüyordu. Burada ilk dokunuş menüyü
// açıp kapatıyor, menüdeki "Hesabım" / "Çıkış" bağlantıları normal çalışıyor.
// ==========================================================
(function initProfileMenuToggle() {
    // Aynı sayfada hem auth.js hem app.js yüklenirse kod ikinci kez çalışıp menüyü
    // açtığı gibi kapatmasın diye tek sefer çalışmasını garanti ediyoruz.
    if (window.__profileMenuToggleInit) return;
    window.__profileMenuToggleInit = true;
    let styleInjected = false;

    // CSS'teki mevcut ":hover" kurallarını ".open" sınıfı için kopyalar,
    // böylece menü mobilde masaüstündekiyle birebir aynı görünür.
    function injectOpenStyles() {
        if (styleInjected) return;
        styleInjected = true;
        let css = '';

        const collect = (rules, wrapMedia) => {
            for (const r of rules) {
                if (r.type === 1 && r.selectorText && r.selectorText.includes('profile-dropdown') && r.selectorText.includes(':hover')) {
                    let text = r.cssText.replace(/:hover/g, '.open');
                    css += wrapMedia ? '@media ' + wrapMedia + '{' + text + '}' : text;
                } else if (r.type === 4 && r.cssRules) { // @media
                    collect(r.cssRules, r.conditionText || (r.media && r.media.mediaText));
                }
            }
        };

        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch (e) { continue; }
            if (rules) collect(rules, null);
        }

        // Hover kuralı bulunamazsa genel bir yedek kural kullan
        if (!css) {
            css = '.profile-dropdown-wrapper.open .profile-dropdown{opacity:1!important;visibility:visible!important;pointer-events:auto!important;}';
        }

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function closeAll() {
        document.querySelectorAll('.profile-dropdown-wrapper.open').forEach(w => {
            w.classList.remove('open');
            const dd = w.querySelector('.profile-dropdown');
            if (dd) dd.style.removeProperty('display');
        });
    }

    document.addEventListener('click', function (e) {
        const isTouch = window.innerWidth <= 992 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        const btn = e.target.closest('.profile-btn');

        if (btn && isTouch) {
            e.preventDefault(); // ilk dokunuşta sayfaya gitme, menüyü aç/kapat
            if (typeof window.ensureProfileDropdown === 'function') window.ensureProfileDropdown();
            injectOpenStyles();
            const wrapper = btn.closest('.profile-dropdown-wrapper');
            if (!wrapper) return;
            const wasOpen = wrapper.classList.contains('open');
            closeAll();
            if (!wasOpen) {
                wrapper.classList.add('open');
                const dd = wrapper.querySelector('.profile-dropdown');
                if (dd && getComputedStyle(dd).display === 'none') dd.style.display = 'block';
            }
            return;
        }

        // Menünün dışına dokunulursa kapat
        if (!e.target.closest('.profile-dropdown-wrapper')) closeAll();
    });
})();


window.handleForgotPassword = async function() {
    const emailInput = document.getElementById('auth-email');
    const email = emailInput ? emailInput.value.trim() : '';
    const errorEl = document.getElementById('auth-error');
    
    if (!email) {
        errorEl.innerText = 'Lütfen şifrenizi sıfırlamak için önce e-posta adresinizi girin.';
        errorEl.style.display = 'block';
        return;
    }
    
    if (!email.includes('@')) {
        errorEl.innerText = 'Lütfen geçerli bir e-posta adresi girin.';
        errorEl.style.display = 'block';
        return;
    }
    
    const btn = document.getElementById('auth-submit-btn');
    const originalBtnText = btn.innerText;
    btn.innerText = "Bağlantı Gönderiliyor...";
    btn.disabled = true;
    errorEl.style.display = 'none';
    
    try {
        await firebase.auth().sendPasswordResetEmail(email);
        errorEl.style.color = '#2ecc71'; // Success green
        errorEl.innerText = 'Şifre sıfırlama bağlantısı e-posta adresinize gönderildi. Lütfen gelen kutunuzu kontrol edin.';
        errorEl.style.display = 'block';
    } catch (error) {
        errorEl.style.color = '#ef4444'; // Error red
        console.error("Şifre sıfırlama hatası:", error);
        if (error.code === 'auth/user-not-found') {
            errorEl.innerText = 'Bu e-posta adresi ile kayıtlı bir hesap bulunamadı.';
        } else if (error.code === 'auth/invalid-email') {
            errorEl.innerText = 'Geçersiz e-posta adresi formatı.';
        } else {
            errorEl.innerText = 'Şifre sıfırlama işlemi sırasında bir hata oluştu. Lütfen tekrar deneyin.';
        }
        errorEl.style.display = 'block';
    } finally {
        btn.innerText = originalBtnText;
        btn.disabled = false;
    }
};
