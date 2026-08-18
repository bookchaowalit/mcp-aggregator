import { getDb, initDb, closeDb } from "../db.js";

console.log("Seeding database...");
await initDb();
const db = await getDb();

// =====================================================
// SEED SKILL CATEGORIES
// =====================================================
const categories = [
    {
        name: "Core CS",
        slug: "core-cs",
        description: "Algorithms, Architecture, OS, Compilers",
        icon: "🧮",
        color: "#3B82F6",
    },
    {
        name: "Infrastructure",
        slug: "infrastructure",
        description: "Linux, Containers, Cloud, Networking",
        icon: "🏗️",
        color: "#10B981",
    },
    {
        name: "Software Engineering",
        slug: "software-engineering",
        description: "Architecture, API, Backend, Frontend",
        icon: "💻",
        color: "#8B5CF6",
    },
    {
        name: "Data",
        slug: "data",
        description: "Data Engineering, Analytics, Streaming",
        icon: "📊",
        color: "#F59E0B",
    },
    {
        name: "AI/ML",
        slug: "ai-ml",
        description: "Machine Learning, Deep Learning, LLM",
        icon: "🤖",
        color: "#EF4444",
    },
    {
        name: "Security",
        slug: "security",
        description: "AppSec, Network, Cloud, Crypto",
        icon: "🔒",
        color: "#6366F1",
    },
    {
        name: "Specialized Engineering",
        slug: "specialized",
        description: "Embedded, IoT, Robotics, FPGA",
        icon: "⚡",
        color: "#EC4899",
    },
    {
        name: "Emerging Tech",
        slug: "emerging",
        description: "Quantum, AR/VR, BCI",
        icon: "🚀",
        color: "#14B8A6",
    },
    {
        name: "Domain-Specific",
        slug: "domain-specific",
        description: "FinTech, HealthTech, Blockchain",
        icon: "🏢",
        color: "#F97316",
    },
    {
        name: "Business Strategy",
        slug: "business-strategy",
        description: "Business Model, Competitive Analysis",
        icon: "📋",
        color: "#0EA5E9",
    },
    {
        name: "Marketing",
        slug: "marketing",
        description: "Digital Marketing, SEO, Content",
        icon: "📣",
        color: "#D946EF",
    },
    {
        name: "Sales",
        slug: "sales",
        description: "B2B, B2C, Consultative Selling",
        icon: "🤝",
        color: "#22C55E",
    },
    {
        name: "Finance",
        slug: "finance",
        description: "Accounting, Tax, Unit Economics",
        icon: "💰",
        color: "#EAB308",
    },
    {
        name: "Legal",
        slug: "legal",
        description: "Contract, IP, Corporate, Privacy",
        icon: "⚖️",
        color: "#64748B",
    },
    {
        name: "Operations",
        slug: "operations",
        description: "PM, Process, Customer Success",
        icon: "⚙️",
        color: "#78716C",
    },
    {
        name: "Psychology",
        slug: "psychology",
        description: "Consumer, Behavioral, Persuasion",
        icon: "🧠",
        color: "#A855F7",
    },
    {
        name: "Communication",
        slug: "communication",
        description: "Copywriting, Storytelling, Speaking",
        icon: "🗣️",
        color: "#F43F5E",
    },
    {
        name: "Leadership",
        slug: "leadership",
        description: "Hiring, Team Building, Culture",
        icon: "👥",
        color: "#06B6D4",
    },
    {
        name: "Health",
        slug: "health",
        description: "Exercise, Nutrition, Mental Health",
        icon: "💪",
        color: "#10B981",
    },
    {
        name: "Longevity",
        slug: "longevity",
        description: "Biomarkers, Sleep, Stress",
        icon: "🧬",
        color: "#8B5CF6",
    },
    {
        name: "Personal Finance",
        slug: "personal-finance",
        description: "Investment, Tax, Insurance",
        icon: "🏦",
        color: "#F59E0B",
    },
    {
        name: "Career",
        slug: "career",
        description: "Writing, Network, Decision",
        icon: "📈",
        color: "#3B82F6",
    },
    {
        name: "Relationships",
        slug: "relationships",
        description: "Communication, Environment",
        icon: "❤️",
        color: "#EF4444",
    },
    {
        name: "Visual Art",
        slug: "visual-art",
        description: "Drawing, Painting, Illustration",
        icon: "🎨",
        color: "#EC4899",
    },
    {
        name: "Design",
        slug: "design",
        description: "Graphic, UI/UX, Brand",
        icon: "✏️",
        color: "#8B5CF6",
    },
    {
        name: "Music",
        slug: "music",
        description: "Theory, Production, Ear Training",
        icon: "🎵",
        color: "#6366F1",
    },
    {
        name: "Writing",
        slug: "writing",
        description: "Fiction, Non-fiction, Content",
        icon: "✍️",
        color: "#0EA5E9",
    },
    {
        name: "Photography",
        slug: "photography",
        description: "Photo, Video, Lighting",
        icon: "📷",
        color: "#14B8A6",
    },
    {
        name: "Architecture",
        slug: "architecture",
        description: "Architecture, Industrial Design",
        icon: "🏛️",
        color: "#78716C",
    },
];

for (const cat of categories) {
    db.prepare(
        "INSERT OR IGNORE INTO skill_categories (name, slug, description, icon, color) VALUES (?, ?, ?, ?, ?)",
    ).run(cat.name, cat.slug, cat.description, cat.icon, cat.color);
}
console.log(`Seeded ${categories.length} skill categories`);

// Get category IDs
const categoryMap: Record<string, number> = {};
const allCats = db
    .prepare("SELECT id, slug FROM skill_categories")
    .all() as any[];
for (const cat of allCats) {
    categoryMap[cat.slug] = cat.id;
}

// =====================================================
// SEED SKILLS
// =====================================================
const skills = [
    // Core CS
    {
        name: "Algorithms & Data Structures",
        slug: "algorithms",
        category: "core-cs",
        target_level: "L3_overview",
        priority: 3,
    },
    {
        name: "Computer Architecture",
        slug: "computer-architecture",
        category: "core-cs",
        target_level: "L3_overview",
        priority: 4,
    },
    {
        name: "Operating Systems",
        slug: "operating-systems",
        category: "core-cs",
        target_level: "L3_overview",
        priority: 3,
    },
    {
        name: "Compiler Design",
        slug: "compiler-design",
        category: "core-cs",
        target_level: "L3_overview",
        priority: 5,
    },
    {
        name: "Distributed Systems",
        slug: "distributed-systems",
        category: "core-cs",
        target_level: "L1_deep",
        priority: 1,
    },
    // Infrastructure
    {
        name: "Linux / Unix",
        slug: "linux",
        category: "infrastructure",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Docker & Kubernetes",
        slug: "containers",
        category: "infrastructure",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Cloud (AWS/GCP/Azure)",
        slug: "cloud",
        category: "infrastructure",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Networking (L2-L7)",
        slug: "networking",
        category: "infrastructure",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Protocol Engineering",
        slug: "protocol-engineering",
        category: "infrastructure",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Platform Engineering",
        slug: "platform-engineering",
        category: "infrastructure",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "Observability",
        slug: "observability",
        category: "infrastructure",
        target_level: "L1_deep",
        priority: 2,
    },
    // Software Engineering
    {
        name: "Software Architecture",
        slug: "software-architecture",
        category: "software-engineering",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "API Design",
        slug: "api-design",
        category: "software-engineering",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "Backend Engineering",
        slug: "backend",
        category: "software-engineering",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Database Engineering",
        slug: "database",
        category: "software-engineering",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "DevOps & CI/CD",
        slug: "devops",
        category: "software-engineering",
        target_level: "L2_capable",
        priority: 2,
    },
    // Data
    {
        name: "Data Engineering",
        slug: "data-engineering",
        category: "data",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Data Analytics",
        slug: "data-analytics",
        category: "data",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "Statistical Thinking",
        slug: "statistics",
        category: "data",
        target_level: "L2_capable",
        priority: 2,
    },
    // AI/ML
    {
        name: "Machine Learning",
        slug: "machine-learning",
        category: "ai-ml",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Deep Learning",
        slug: "deep-learning",
        category: "ai-ml",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "NLP / LLM",
        slug: "nlp-llm",
        category: "ai-ml",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "Computer Vision",
        slug: "computer-vision",
        category: "ai-ml",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "MLOps / LLMOps",
        slug: "mlops",
        category: "ai-ml",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "AI Agents",
        slug: "ai-agents",
        category: "ai-ml",
        target_level: "L1_deep",
        priority: 1,
    },
    {
        name: "RAG Systems",
        slug: "rag",
        category: "ai-ml",
        target_level: "L1_deep",
        priority: 1,
    },
    // Security
    {
        name: "Application Security",
        slug: "appsec",
        category: "security",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "Cryptography",
        slug: "cryptography",
        category: "security",
        target_level: "L2_capable",
        priority: 3,
    },
    {
        name: "Cloud Security",
        slug: "cloud-security",
        category: "security",
        target_level: "L2_capable",
        priority: 2,
    },
    // Business
    {
        name: "Business Strategy",
        slug: "business-strategy-skill",
        category: "business-strategy",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Unit Economics",
        slug: "unit-economics",
        category: "business-strategy",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Pricing Strategy",
        slug: "pricing",
        category: "business-strategy",
        target_level: "L2_capable",
        priority: 1,
    },
    // Marketing
    {
        name: "SEO / Content Marketing",
        slug: "seo-content",
        category: "marketing",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Email Marketing",
        slug: "email-marketing",
        category: "marketing",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Social Media Marketing",
        slug: "social-media",
        category: "marketing",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "Growth Hacking",
        slug: "growth",
        category: "marketing",
        target_level: "L3_overview",
        priority: 3,
    },
    // Sales
    {
        name: "Consultative Selling",
        slug: "consultative-selling",
        category: "sales",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Negotiation",
        slug: "negotiation",
        category: "sales",
        target_level: "L2_capable",
        priority: 2,
    },
    // Communication
    {
        name: "Copywriting",
        slug: "copywriting",
        category: "communication",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Technical Writing",
        slug: "technical-writing",
        category: "communication",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "Storytelling",
        slug: "storytelling",
        category: "communication",
        target_level: "L2_capable",
        priority: 2,
    },
    // Life
    {
        name: "Strength Training",
        slug: "strength-training",
        category: "health",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Nutrition",
        slug: "nutrition",
        category: "health",
        target_level: "L2_capable",
        priority: 2,
    },
    {
        name: "Sleep Optimization",
        slug: "sleep",
        category: "longevity",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Tax Optimization",
        slug: "tax",
        category: "personal-finance",
        target_level: "L2_capable",
        priority: 1,
    },
    {
        name: "Investment",
        slug: "investment",
        category: "personal-finance",
        target_level: "L2_capable",
        priority: 2,
    },
    // Creative
    {
        name: "Typography",
        slug: "typography",
        category: "design",
        target_level: "L3_overview",
        priority: 3,
    },
    {
        name: "UI/UX Design",
        slug: "ui-ux",
        category: "design",
        target_level: "L3_overview",
        priority: 3,
    },
];

for (const skill of skills) {
    const catId = categoryMap[skill.category];
    if (catId) {
        db.prepare(
            "INSERT OR IGNORE INTO skills (name, slug, category_id, target_level, priority, status, progress_percent) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
            skill.name,
            skill.slug,
            catId,
            skill.target_level,
            skill.priority,
            "not_started",
            0,
        );
    }
}
console.log(`Seeded ${skills.length} skills`);

// =====================================================
// SEED OPPORTUNITIES
// =====================================================
const opportunities = [
    {
        name: "AI Automation Agency",
        type: "service",
        tier: 1,
        description: "สร้าง automation ให้ธุรกิจด้วย n8n, Make, custom agents",
        pain_level: 4,
        budget_level: 4,
        frequency_level: 4,
        ai_leverage_level: 5,
        competition_level: 3,
        distribution_level: 3,
        fit_level: 4,
        target_market: "SME ไทย",
        revenue_model: "Project-based + retainer",
        price_range: "฿50K-500K/project",
    },
    {
        name: "RAG-as-a-Service",
        type: "saas",
        tier: 1,
        description: "สร้าง knowledge base + AI chatbot สำหรับธุรกิจ",
        pain_level: 4,
        budget_level: 4,
        frequency_level: 5,
        ai_leverage_level: 5,
        competition_level: 3,
        distribution_level: 3,
        fit_level: 5,
        target_market: "บริษัทที่มีเอกสารเยอะ",
        revenue_model: "Setup + monthly retainer",
        price_range: "฿30K setup + ฿10-50K/month",
    },
    {
        name: "AI Content Pipeline",
        type: "service",
        tier: 1,
        description: "สร้าง content system ที่ใช้ AI + human review",
        pain_level: 3,
        budget_level: 3,
        frequency_level: 5,
        ai_leverage_level: 5,
        competition_level: 4,
        distribution_level: 3,
        fit_level: 4,
        target_market: "Brand, Agency, Creator",
        revenue_model: "Monthly retainer",
        price_range: "฿20K-100K/month",
    },
    {
        name: "AI-Powered Niche SaaS",
        type: "saas",
        tier: 1,
        description: "สร้าง SaaS ที่มี AI เป็น core สำหรับ niche เฉพาะ",
        pain_level: 5,
        budget_level: 4,
        frequency_level: 5,
        ai_leverage_level: 5,
        competition_level: 2,
        distribution_level: 2,
        fit_level: 4,
        target_market: "Niche-specific",
        revenue_model: "Subscription",
        price_range: "฿500-5,000/month/user",
    },
    {
        name: "Fine-tuning Service",
        type: "service",
        tier: 1,
        description: "Fine-tune model สำหรับ use case เฉพาะ",
        pain_level: 4,
        budget_level: 5,
        frequency_level: 3,
        ai_leverage_level: 5,
        competition_level: 2,
        distribution_level: 2,
        fit_level: 4,
        target_market: "Enterprise",
        revenue_model: "Project-based",
        price_range: "฿100K-1M+/project",
    },
    {
        name: "AI Consulting",
        type: "consulting",
        tier: 1,
        description: "ช่วยบริษัทเลือกและ deploy AI solution",
        pain_level: 4,
        budget_level: 5,
        frequency_level: 3,
        ai_leverage_level: 4,
        competition_level: 3,
        distribution_level: 3,
        fit_level: 5,
        target_market: "Enterprise, Government",
        revenue_model: "Hourly/project",
        price_range: "฿5K-50K/hour",
    },
];

for (const opp of opportunities) {
    const score =
        (opp.pain_level || 3) * 0.2 +
        (opp.budget_level || 3) * 0.2 +
        (opp.frequency_level || 3) * 0.15 +
        (opp.ai_leverage_level || 3) * 0.15 +
        (opp.competition_level || 3) * 0.1 +
        (opp.distribution_level || 3) * 0.1 +
        (opp.fit_level || 3) * 0.1;
    db.prepare(
        "INSERT INTO opportunities (name, description, type, tier, pain_level, budget_level, frequency_level, ai_leverage_level, competition_level, distribution_level, fit_level, total_score, target_market, revenue_model, price_range, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
        opp.name,
        opp.description,
        opp.type,
        opp.tier,
        opp.pain_level,
        opp.budget_level,
        opp.frequency_level,
        opp.ai_leverage_level,
        opp.competition_level,
        opp.distribution_level,
        opp.fit_level,
        score,
        opp.target_market,
        opp.revenue_model,
        opp.price_range,
        "researching",
    );
}
console.log(`Seeded ${opportunities.length} opportunities`);

// =====================================================
// SEED GOALS
// =====================================================
const goals = [
    {
        title: "ระบุ 3 AI arbitrage niches",
        type: "monthly",
        category: "business",
        priority: 1,
        description:
            "หา 3 niche ที่มี painful problem + มีเงิน + AI ยังเข้าไม่ถึง",
    },
    {
        title: "เลือก niche หลัก",
        type: "monthly",
        category: "business",
        priority: 1,
        description: "skill + industry + painful outcome + proof",
    },
    {
        title: "Setup distribution channel",
        type: "monthly",
        category: "business",
        priority: 1,
        description: "Email list / LinkedIn / niche community",
    },
    {
        title: "สร้าง AI product/service แรก",
        type: "monthly",
        category: "tech",
        priority: 1,
        description: "ขายเลย ไม่ต้องรอ perfect",
    },
    {
        title: "Blood work + VO2 max check",
        type: "monthly",
        category: "health",
        priority: 2,
        description: "รู้ก่อนที่จะรู้สึกผิดปกติ",
    },
    {
        title: "Deep dive Infra/DevOps",
        type: "quarterly",
        category: "tech",
        priority: 1,
        description: "Pi-shaped ขาแรก",
    },
    {
        title: "Deep dive AI/ML",
        type: "quarterly",
        category: "tech",
        priority: 1,
        description: "Pi-shaped ขาที่สอง",
    },
    {
        title: "สร้าง audience อย่างน้อย 1 ช่องทาง",
        type: "quarterly",
        category: "business",
        priority: 1,
        description: "Email list, YouTube, LinkedIn",
    },
];

for (const goal of goals) {
    db.prepare(
        "INSERT INTO goals (title, description, type, category, priority, status, progress_percent) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
        goal.title,
        goal.description,
        goal.type,
        goal.category,
        goal.priority,
        "active",
        0,
    );
}
console.log(`Seeded ${goals.length} goals`);

console.log("Database seeded successfully!");
closeDb();
