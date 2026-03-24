import pg from 'pg';

const staffList = [
    "Mrs. Saly Antony- - dont assign, department = CE",
    "Mr. Manvendra Sinha- dont assign, department = CE",
    "Mr. Shashikant Sawant department = CE",
    "Ms Nirmala Mascarenhas department = CE",
    "Ms. Amarpreet Kaur department = CE",
    "Mrs. Seema Kshirsagar department = CE",
    "Mrs. Papiya Bala department = CE",
    "Mr. Vishal Ravaji Dalvi department = CE",
    "Mr. Lewis Anthony department = CE",
    "Ms. Beenu Johnkutty- dont assign, department = ME",
    "Mr. Yogesh Vishwakarma department = ME",
    "Mrs. Pratima Kokate department = ME",
    "Mr. Ravindra Dhawale department = ME",
    "Mrs. Suvarchala Motukuru department = ME",
    "Mr Vivek Fegade department = ME",
    "Mr. Milind Shrirao department = ME",
    "Mr. Ganesh Gawande department = ME",
    "Ms. Madhuri Jadhav department = ME",
    "Mr. Chetan Baviskar department = ME",
    "Mr. Premkumar Joshi department = ME",
    "Mr. Momin Musheer department = ME",
    "Mr. Venugopal Kurup dont assign, department = ",
    "Mrs. Malini Pawnday department = me",
    "Mrs. Roopa Shetty department = management",
    "Mr. Upendra Rai department = ce",
    "Mrs. Purnima M. Barhate department = me",
    "Mrs. Deepti Hurgat department = te",
    "Mrs. R.P. Snehalatha department = ae",
    "Mrs. Shalvi Bahadur department = management",
    "MS. Susan Sabu Manimala department = an",
    "Mrs. Raji M.P. dont assign, department = TE",
    "Mrs. Jewel Samantha department = TE",
    "Mrs. Suhasini David Sekhar department = TE",
    "Mr. Umesh Mhapankar department = TE",
    "Ms. Archana Wasule department = TE",
    "Mrs. Varsha Meshram department = TE",
    "Mr. Amol Suryavanshi department = TE",
    "Mr. Nitin Kulkarni dont assign, department = AE",
    "Mr. Dinesh Patil department = AE",
    "Ms. Cige Louis department = AE",
    "Mr. Satish Eandole department = AE",
    "Mr. Mahesh S. Vhanmane department = AE",
    "Ms. Ruchira Kishen Shinde department = AE",
    "Mrs. Sonali Sherigar dont assign,department = AN",
    "Mr. Pranavkumar Ajay Bhadane dont assign,department = AN",
    "Mrs. Samina Siddiquie department = AN",
    "Mrs. Kirti R. Karande department = AN",
    "Mrs. Namrata Swapnil Thakur department = AN",
    "Ms. Monali C department = AN"
];

function generateSQL(list) {
    const values = list.map(line => {
        const dontAssign = line.toLowerCase().includes("dont assign");
        const deptMatch = line.match(/department\s*=\s*(\w+)/i);
        let dept = deptMatch ? deptMatch[1].toUpperCase() : "UNKNOWN";
        if (line.toLowerCase().includes("management")) dept = "MANAGEMENT";

        let nameRaw = line.split(/[-]|dont assign|department/i)[0].trim();
        const prefixes = ["Mrs.", "Mr.", "Ms.", "MS.", "Mrs", "Mr", "Ms"];
        let cleanNameForUser = nameRaw;
        
        prefixes.forEach(p => {
            if (cleanNameForUser.startsWith(p)) {
                cleanNameForUser = cleanNameForUser.substring(p.length).trim();
            }
        });

        const username = cleanNameForUser.toLowerCase().replace(/[^a-z]/g, "");
        const password = `${username}@089`;

        return `('${nameRaw.replace(/'/g, "''")}', '${dept}', '${username}', '${password}', ${dontAssign})`;
    });

    return `INSERT INTO staff (staff_name, department, username, password, dont_assign) VALUES\n` + values.join(",\n") + "\nON CONFLICT (username) DO UPDATE SET staff_name = EXCLUDED.staff_name, department = EXCLUDED.department, dont_assign = EXCLUDED.dont_assign;";
}

const pool = new pg.Pool({
    connectionString: 'postgresql://neondb_owner:npg_GhsaYQHrJ5N4@ep-dry-cloud-adj9t3b3-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ssl: { rejectUnauthorized: false }
});

const sql = generateSQL(staffList);
pool.query(sql)
    .then(() => {
        console.log('Bulk staff members have been upserted successfully.');
        process.exit(0);
    })
    .catch(err => {
        console.error('Error inserting staff:', err);
        process.exit(1);
    });
