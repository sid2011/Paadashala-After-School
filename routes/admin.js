var express = require('express');
const { ObjectId } = require('mongodb');
var router = express.Router();
const db = require("../config/connections");
const collections=require("../config/collections")

router.get('/', (req, res)=> {
    res.render('admin/admin',{layout: 'admin-layout'});
});

router.get('/students', async(req, res)=>{
    const student=await db.get().collection(collections.STUDENT_COLLECTION).find().toArray()

res.render('admin/students',{layout:false,student});
});
router.post('/students/register',async(req,res)=>{
    const studentId = "PAD" + Math.floor(1000 + Math.random() * 9000);
    const student={
        studentId:studentId,
        name:req.body.name,
        parentName:req.body.parentName,
        parentNo:req.body.phone,
        class:req.body.class,
        academicYear:req.body.academicYear,
        address:req.body.address
    }
    await db.get().collection(collections.STUDENT_COLLECTION).insertOne(student)
    return res.redirect('/admin')
})
router.get('/teachers', async(req, res)=> {
const teacher=await db.get().collection(collections.TEACHER_COLLECTION).find().toArray()
console.log(teacher)
res.render('admin/teachers',{layout:false,teacher});
});
router.post('/teachers/register',async(req,res)=>{
    const teacherId = "TCH" + Math.floor(1000 + Math.random() * 9000);
    const teacher={
        teacherId:teacherId,
        name:req.body.name,
        email:req.body.email,
        phoneNo:req.body.phone,
        subject:req.body.subject,
        address:req.body.address
    }
    await db.get().collection(collections.TEACHER_COLLECTION).insertOne(teacher)
    return res.redirect('/admin')
})
router.get('/students/attendance',async(req,res)=>{
    res.render('admin/attendance',{layout:false})
})
module.exports = router;