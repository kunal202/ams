//jshint esversion:6
const express = require("express")
const bodyParser = require("body-parser");
const ejs = require("ejs");
const util = require(__dirname + "/../functions.js")
const db = require(__dirname + "/../dbfunctions/teacher.js")
const dateFns = require('date-fns')

const router = express.Router();

const redirectLogin = (req, res, next) => {
  if(req.session.userType != "teacher") {
    if(req.session.userType == "admin") {
			res.redirect("/admin/teacher")
		} else {
			res.redirect("/");
		}
  }
  else {
    next()
  }
}

const sectionAccessibility = (req, res, next) => {

  var selectedSection = req.params.section;

  if(req.session.userSections.findIndex(element => selectedSection.toUpperCase().startsWith(element)) == -1 ) {
    return res.send("<h2>You cannot access that section</h2>");
  }
  else {
    next()
  }
}

router.use(redirectLogin)

router.get(["/", "/timeTable"], async (req, res) => {

  let timeTable;
  await new Promise((resolve, reject) => {
    util.getConnection().query(`select * from teacher_${req.session.userId}`, (err, result) => {
      timeTable = result;
      resolve(1);
    });
  });


  let lecturesCompleted = [];
  await new Promise(async (resolve, reject) => {

    util.getConnection().query(`select section, subject, total_lectures from department_it where teacher_id='${req.session.userId}' order by section asc`, (err, result) => {
      if(err) {
        console.log(err);
        res.send("Something went wrong");
      } else if(result.length ==0) {
        res.send("No records available")
      } else {

        for(let i=0; i<result.length; i++) {

          lecturesCompleted.push([result[i].section, result[i].subject, result[i].total_lectures]);
				}


				//creating subjects array from lecturesCompleted
				var subjects = [];
				for(let i=0; i<lecturesCompleted.length; i++) {
					util.addElement(subjects, lecturesCompleted[i][1]);
				}

				console.log("teacher profile", req.session.userId, req.session.userName)

				res.render("timeTable", {
					timeTable: timeTable,
					lecturesCompleted: lecturesCompleted,
					teacherProfile: {
						id: req.session.userId,
						name: req.session.userName,
						department: req.session.department,
						type: req.session.userType,
						subjects: subjects
					}
				})

      }
    })
    resolve(true);
  });

});


router.get("/attendance/:lecture/:cell", async (req, res) => {


  //TODO: split last url param to store section, subject, group if cell contains lab
  var params = req.params;

  //splitting the cell into section, subject, lab(if exist), lab grp(if lab exists)
  var cell = params.cell.split(' ');
  req.session.selectedSection = cell[1].toLowerCase();
  req.session.userSubject = cell[0];
  req.session.userClassGrp = '';
  if(cell.length >= 4) {
    req.session.userSubject += " LAB";
    req.session.userClassGrp = cell[2];
  }


  req.session.lecture = req.params.lecture;


  if(req.session.userSections.findIndex(element => req.session.selectedSection.toUpperCase().startsWith(element)) == -1 ) {
    return res.send("<h2>You cannot access that section</h2>");
  }


  var valid_entry = await checkValidEntry(req.session.selectedSection, req.session.userSubject, date="", req.session.lecture[3]);

  if(valid_entry == -1) {
    return res.send("Some error occured")
  } else if(valid_entry == 1146) {
		res.send("NO data available for requested section");
	} else if(!valid_entry) {
    return res.send(`
      attendance already taken
      <br>
      <a href='/teacher/timeTable'>home</a>
    `);
  }


  var sqlGrpString = req.session.userClassGrp?` where studentRollNo like '${req.session.userClassGrp.toLowerCase()}%'`:'';
  // console.log("sqlgrpstring", sqlGrpString);

  util.getConnection().query(`select * from section_${req.session.selectedSection}` + sqlGrpString, (err, result) => {

    if(err) {
      console.log(err)
      return console.log("cannot process further");
    } else if(result.length === 0) {
      console.log("NO students");
      res.send("No students available");
    }
    req.session.Students = result;
    res.render("attendance", {Students: req.session.Students});

    console.log(req.session.userId);

    req.session.totalStudents = result.length;

    req.session.save();
    //res.send(result);
    // console.log(req.session);
  });
});


router.post("/attendance", async (req, res) => {

  const attendStatus = req.body;
  console.log(attendStatus);

  let rollNumbers = '';
  let attendanceList = "";

  for(let i=0; i<req.session.totalStudents; i++) {
    if(attendStatus[`${req.session.Students[i].studentRollNo}`]) {
      attendanceList += "'P', ";
    }
    else {
      attendanceList += "'A', ";
    }
    rollNumbers += `${req.session.Students[i].studentRollNo}, ` ;
  }

  console.log(req.session);


  //check if attendance had already taken
  var valid_entry = await checkValidEntry(req.session.selectedSection, req.session.userSubject, date="", req.session.lecture[3]);

  if(valid_entry == -1) {
    return res.send("Some error occured")
	} else if(valid_entry == 1146) {
		res.send("NO data available for requested section");
	}	else if(!valid_entry) {
    return res.send(`
      attendance already taken
      <br>
      <a href='timeTable'>home</a>
    `);
  }


  let sql = `insert into section_${req.session.selectedSection}_attendance (lecture, grp, lecture_date, lecture_no, userID, ${rollNumbers.substring(0, rollNumbers.length-2)}) values('${req.session.userSubject}', '${req.session.userClassGrp===''?'Both':req.session.userClassGrp}', '${dateFns.format(new Date(), 'yyyy:MM:dd')}', '${Number(req.session.lecture[3])}', '${req.session.userId}', ${attendanceList.substring(0, attendanceList.length-2)})`;

  util.getConnection().query(sql, (err, result) => {
    if(err) {
      console.log(err);
      res.send(`Error, ${err.code}`)
    } else {

      res.send(`Attendance done, you can return to <a href='/teacher/timeTable'>Home</a>`);                         //needs to be change

      // let total_lectures = await util.getTotalLectures(req.session.userSubject, req.session.selectedSection, req.session.department);

      let sql2 = `update department_${req.session.department} set total_lectures=total_lectures+1 where Teacher_id='${req.session.userId}' and section='${req.session.selectedSection} ${req.session.userClassGrp}' and subject='${req.session.userSubject}'`;

      util.getConnection().query(sql2, (err, result) => {
        if(err) {
          console.log(err);
        }
      });

    }
  });
});


router.get("/:section/:subject", sectionAccessibility, async (req, res) => {

  var param1 = req.params.section.split(" ");

  var section = param1[0].toLowerCase();

  var grp = "";
  if(param1.length == 2) {
    grp = param1[1];
  }

  var subject = [{subject: req.params.subject}];


  // var subject = await db.getSubjects(req.session.department, req.session.userId, section)

  console.log(req.session.department, req.session.userId, section, subject);

  var totalLectures = await util.getTotalLectures(subject[0].subject, section + " " + grp, req.session.department)

  if(totalLectures == 0) {
    return res.send("No attendance taken for this lecture")
  }

  var sectionAttendance = await db.getSectionDetails(section, subject[0].subject, grp);

  console.log("section details:", sectionAttendance);


  if(Array.isArray(sectionAttendance) && sectionAttendance[0] === -1) {
    res.send(`Error: ${sectionAttendance[1]}`)
  } else if(sectionAttendance === 0) {
    res.send('No attendance taken for this lecture')
  } else {

    var arr = [];
    arr.push(['Roll No', 'Attendance', 'Percentage'])

    var keys = Object.keys(sectionAttendance[0])

    //filterout only rollnumber keys
    keys.splice(0,6)


    //filling all lecture dates
    for(let i=0; i<sectionAttendance.length; i++) {
      arr[0].push(dateFns.format(sectionAttendance[i].lecture_date, 'dd-MM-yyyy'))
    }

    //filling table rows with data
    for(let j=0; j<keys.length; j++) {

      let tempArr = [];

      if(keys[j][0].toLowerCase() == grp.toLowerCase() || !grp) {

              //inserting rollnumbers
              tempArr[0] = keys[j].substring(1, keys[j].length);

              //inserting present and absent states to roll numbers
              for(let i=0; i<sectionAttendance.length; i++) {
                tempArr[i+1] = sectionAttendance[i][keys[j]]
              }

              arr.push(tempArr)
      }
    }

    // console.log("array:", arr)


    // if(grp) {
    //   var section;
    // }



    //calculating total days attended
    for(let i=1; i<arr.length; i++) {

      let attend = 0;
      for(let j=1; j<arr[i].length; j++) {

        // if(arr[i])
        if(arr[i][j] === 'P') {
          attend++;
        }
      }

      //inserting attended days
      arr[i].splice(1, 0, attend)

      //calculating and inserting percentage
      arr[i].splice(2, 0, Number.parseFloat((attend*100)/totalLectures).toPrecision(4))

    }


    console.log("Array:", arr);
    res.render("sectionDetails", {
      section: "section: " + section,
      arr: arr
    })
  }

})


async function checkValidEntry(section, subject, date, lecture_no) {

  let valid_entry = await new Promise((resolve, reject) => {
    util.getConnection().query(`select SNo from section_${section}_attendance where lecture='${subject}' and lecture_date='${dateFns.format(new Date(), 'yyyy-MM-dd')}' and lecture_no=${lecture_no}`, (err, result) => {
      if(err) {
				console.log(err);
				if(err.errno == 1146) {
					resolve(err.errno)
				} else {
					resolve(-1)
				}

      }
      else if(result.length >= 1) {
        resolve(0)
      }
      else {
        resolve(1)
      }
    })
  })
  return valid_entry;
}



module.exports = router;
