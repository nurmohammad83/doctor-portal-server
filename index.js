const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
require('dotenv').config()
const port = process.env.Port || 5000;



app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tcnszhx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req,res,next){
  const authHeaders = req.headers.authorization
  if(!authHeaders){
    return res.status(401).send('unauthorized access')
  }
  const token = authHeaders.split(' ')[1]
  jwt.verify(token, process.env.DB_ACCESS_TOKEN, function(err,decoded){
    if(err){
      return res.status(403).send({message: 'forbidden access'})
    }
    req.decoded = decoded
    next();
  })

}

async function run (){
    
  try {
    const appointmentOptionCollection = client.db('doctorPortal').collection('appointmentOption')
    const bookingsCollection = client.db('doctorPortal').collection('bookings')
    const usersCollection = client.db('doctorPortal').collection('users')
    const doctorsCollection = client.db('doctorPortal').collection('doctors')
  
    app.get('/appointmentOptions',async (req,res)=>{
     
      const date = req.query.date
      const query={}
      const options= await appointmentOptionCollection.find(query).toArray()  
      // Get the booking at the previous date
      const bookingQuery= {appointmentDate : date}
      const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray()

      // code carefuly Declear
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.patientTreatment === option.name);
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots;
    })
      res.send(options);
      
    })
    

    app.get('/appointmentSpecialty', async(req,res)=>{
      const query = {}
      const specialty = await appointmentOptionCollection.find(query).project({name:1}).toArray()
      res.send(specialty)
    })

    app.get('/bookings',verifyJWT, async(req,res)=>{
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if(email !== decodedEmail){
        return res.status(403).send({message: 'forbidden access'})
      }
      const query = {email: email}
      const result = await bookingsCollection.find(query).toArray()
      res.send(result)
    })
    
    app.post('/bookings', async (req,res)=>{
      const booking = req.body
      const query = {
        appointmentDate:booking.appointmentDate
      }

      const alreadyBooked = await bookingsCollection.find(query).toArray() 
      
      if(alreadyBooked.length){
        const message = `Your already Booking on ${booking?.appointmentDate}`
        return res.send({acknowledged: false,message})
      }

      const result = await bookingsCollection.insertOne(booking)
      res.send(result)
    })

    app.get('/jwt', async(req,res)=>{
      const email = req.query.email
      const query = {email: email}
      const user = await usersCollection.findOne(query)
      console.log(user);
      if(user){
        const token = jwt.sign({email}, process.env.DB_ACCESS_TOKEN ,{expiresIn:'1h'})
        res.send({accessToken: token})
      }
      res.status(403).send({accessToken: ''})
    })

    app.get('/users', async(req,res)=>{
      const query = {}
      const users= await usersCollection.find(query).toArray()
      res.send(users)
    })
    

    app.get('/users/admin/:email', async (req,res)=>{
      const email = req.params.email;
      const query = {email}
      const user = await usersCollection.findOne(query)
      res.send({isAdmin: user?.role === 'admin'})
    })


    app.post('/users', async (req,res)=>{
      const user = req.body
      const result = await usersCollection.insertOne(user)
      res.send(result)
    })

    app.put('/users/admin/:id',verifyJWT, async(req,res)=>{
      const decodedEmail = req.decoded.email
      const query = {email: decodedEmail}
      const user = await usersCollection.findOne(query)
      if(user?.role !== 'admin'){
        res.status(403).send({message: 'Forbidden Access'})
      }
      const id = req.params.id;
      const filter = {_id: ObjectId(id)}
      const options = { upsert: true }
      const updateDoc = {
        $set:{
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter,updateDoc,options)
      res.send(result)
    })


    app.get('/',(req,res)=>{
      res.send('Doctor Aschen')
    })

    app.get('/doctors', async(req,res)=>{
      const query = {}
      const result= await doctorsCollection.find(query).toArray()
      res.send(result)
    })
    app.post('/doctors', async(req,res)=>{
      const doctor  = req.body;
      const result = await doctorsCollection.insertOne(doctor)
      res.send(result)
    })

  } catch (error) {
    console.log(error);
  }
}
run()


app.listen(port,()=>{
  console.log('doctor Protal running on ',port);
})
// app.get('/v2/appointmentOptions', async(req,res)=>{
//   const date = req.query.date;
//   const options = await appointmentOptionCollection.aggregate([

//     {
//       $lookup:{
//         from: 'bookings',
//         localField: 'name',
//         foreignField: 'treatment',
//         pipeline:[
//           {
//             $match:{
//               $expr:{
//                 $eq:['appointmentDate', date]
//               }
//             }
//           }
//         ],
//         as: 'booked'
//       }  
//     },
//     {
//       project:{
//         name:1,
//         slot:1,
//         booked:{
//           $map:{
//             input:'$booked',
//             as:'book',
//             in:'$$book.slot'
//           }
//         }
//       }
//     },
//     {
//       $project:{
//         name:1,
//         slots:{
//           $setDifference:['$slots', '$booked']
//         }
//       }
//     }
//   ]).toArray()
//   res.send(options);

// })