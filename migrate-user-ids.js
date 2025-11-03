const Database = require('./src/database');

/**
 * Migration script to fix user_id formatting in production database
 * Converts user_id values like "6082711355.0" to "6082711355"
 */
async function migrateUserIds() {
    console.log('🔧 Starting user_id migration...');

    const db = new Database();
    await db.init();

    try {
        // Get all reservations with user_id containing decimal point
        const reservations = await db.query(
            `SELECT id, user_id, date, spot_number FROM reservations WHERE user_id LIKE '%.%'`
        );

        console.log(`📊 Found ${reservations.length} reservations with decimal user_id`);

        // Fix each reservation
        for (const reservation of reservations) {
            const oldUserId = reservation.user_id;
            const newUserId = String(parseInt(oldUserId)); // Convert "6082711355.0" to "6082711355"

            await db.query(
                `UPDATE reservations SET user_id = ? WHERE id = ?`,
                [newUserId, reservation.id]
            );

            console.log(`  ✅ Fixed reservation ${reservation.id}: "${oldUserId}" -> "${newUserId}"`);
        }

        // Get all waitlist entries with user_id containing decimal point
        const waitlist = await db.query(
            `SELECT id, user_id, date FROM waitlist WHERE user_id LIKE '%.%'`
        );

        console.log(`📊 Found ${waitlist.length} waitlist entries with decimal user_id`);

        // Fix each waitlist entry
        for (const entry of waitlist) {
            const oldUserId = entry.user_id;
            const newUserId = String(parseInt(oldUserId));

            await db.query(
                `UPDATE waitlist SET user_id = ? WHERE id = ?`,
                [newUserId, entry.id]
            );

            console.log(`  ✅ Fixed waitlist ${entry.id}: "${oldUserId}" -> "${newUserId}"`);
        }

        console.log('\n✨ Migration completed successfully!');

        // Verify the fix
        console.log('\n🔍 Verifying migration...');
        const remainingIssues = await db.query(
            `SELECT COUNT(*) as count FROM reservations WHERE user_id LIKE '%.%'`
        );

        if (remainingIssues[0].count === 0) {
            console.log('✅ All user_ids are now properly formatted');
        } else {
            console.log(`⚠️ Still have ${remainingIssues[0].count} reservations with decimal user_id`);
        }

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

// Run migration
migrateUserIds().then(() => {
    console.log('\n👋 Migration script finished');
    process.exit(0);
}).catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
