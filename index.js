const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const nodemailer = require('nodemailer');
const Stripe = require("stripe")
require('dotenv').config()
const port = process.env.Port || 5000;
const stripe = Stripe(process.env.DB_STRIP_SK)

app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tcnszhx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function sendBookingEmail(booking){
  const {patientTreatment,email,appointmentDate,slot}=booking
  let transporter = nodemailer.createTransport({

    host: "smtp.sendgrid.net",
    port: 587,
    auth: {
      user: 'apikey', 
      pass: process.env.SENDGRID_API_KEY,
    },
  })
  transporter.sendMail({
    from: "pesfootball83@gmail.com", // verified sender email
    to: email, // recipient email
    subject: `Your appointment for ${patientTreatment} is confirmed`, // Subject line
    text: "Hello world!", // plain text body
    html: `
    <h3>Your Appointment is confirmed</h3>
    <div>
    
    <p>
    Your appointment for treatment : ${patientTreatment}
    </p>
    <p>
    Please visit us on : ${appointmentDate} at ${slot}
    </p>
    </div>
    `, // html body
  }, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });
}
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
    const paymentsCollection = client.db('doctorPortal').collection('payments')
  
//Make Sure you use verifyAdmin after verifyJwt
    const verifyAdmin =async(req,res,next)=>{
      const decodedEmail = req.decoded.email
        const query = {email: decodedEmail}
        const user = await usersCollection.findOne(query)
        if(user?.role !== 'admin'){
          res.status(403).send({message: 'Forbidden Access'})
        }
        next()
    }

    // AppointmentCollection
    // -------------Get Api---------------

    app.get('/appointmentOptions',async (req,res)=>{
     
      const date = req.query.date
      const query={}
      const options= await appointmentOptionCollection.find(query).toArray()  
      // Get the booking at the previous date
      const bookingQuery= {appointmentDate : date}
      const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray()

      // code carefully  
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.patientTreatment === option.name);
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots;
    })
      res.send(options);
      
    })
    
    app.get('/doctors', async(req,res)=>{
      const query = {}
      const result= await doctorsCollection.find(query).toArray()
      res.send(result)
    })

    app.get('/appointmentSpecialty', async(req,res)=>{
      const query = {}
      const specialty = await appointmentOptionCollection.find(query).project({name:1}).toArray()
      res.send(specialty)
    })
    app.get('/bookings/:id',async(req,res)=>{
      const id = req.params.id
      const query = { _id: ObjectId(id)}
      const result = await bookingsCollection.findOne(query)
      res.send(result)
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

    // UsersCollection API
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
// -----------Post Api--------------
    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      console.log(amount)
      const paymentIntent = await stripe.paymentIntents.create({
          currency: 'usd',
          amount: amount,
          "payment_method_types": [
              "card"
          ]
      });
      res.send({
          clientSecret: paymentIntent.client_secret,
      });
  });

    app.post('/payments',async(req,res)=>{
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = {_id:ObjectId(id)}
      const updateDoc= {
        $set: {
          paid: true,
          transactionId: payment.transactionId
        }
      }
      const updatedResult = await bookingsCollection.updateOne(filter,updateDoc)

      res.send(result)
    })
    
    
    app.post('/bookings', async (req,res)=>{
      const booking = req.body
      const query = {
        appointmentDate:booking.appointmentDate,
        email:booking.email,
        patientTreatment:booking.patientTreatment
      }
      const alreadyBooked = await bookingsCollection.find(query).toArray() 
      if(alreadyBooked.length){
        const message = `Your already Booking on ${booking?.appointmentDate}`
        return res.send({acknowledged: false,message})
      }

      const result = await bookingsCollection.insertOne(booking)
      sendBookingEmail(booking)
      res.send(result)
    })

    app.post('/users', async (req,res)=>{
      const user = req.body
      const result = await usersCollection.insertOne(user)
      res.send(result)
    })

    app.post('/doctors',verifyJWT,verifyAdmin, async(req,res)=>{
      const doctor  = req.body;
      const result = await doctorsCollection.insertOne(doctor)
      res.send(result)
    })
// -----------Put Api----------
    app.put('/users/admin/:id',verifyJWT,verifyAdmin, async(req,res)=>{
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

   
  // ---------------Delete Api--------------

    app.delete('/doctors/:id',verifyJWT,verifyAdmin, async(req,res)=>{
      const id = req.params.id;
      const filter={_id:ObjectId(id)}
      const result = await doctorsCollection.deleteOne(filter)
      res.send(result)
    })
    app.delete('/users/:id',verifyJWT,verifyAdmin, async (req, res) => {
      const id = req.params.id;
      console.log(id)
      const query = { _id: ObjectId(id) }
      const result = await usersCollection.deleteOne(query)
      res.send(result)
  })



  // Optional Api
    app.get('/', (req,res)=>{
      res.send('Doctor Achen')
    })
  } catch (error) {
    console.log(error);
  }
}
run()


app.listen(port,()=>{
  console.log('doctor Protal running on ',port);
})